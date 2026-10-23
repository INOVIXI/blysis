// @vitest-environment node
/**
 * Asking a game server whether it is up.
 *
 * The old implementation asked a third party about one hardcoded host and
 * always got a Minecraft answer, so a site with a Rust server showed offline
 * forever. These tests hold the replacement to what it claims: the right
 * protocol per game, read from the row the admin panel edits, and a server
 * that says nothing is down rather than an exception.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import net from "net";
import dgram from "dgram";

interface ServerRow {
    id: string;
    name: string;
    type: string;
    host: string;
    port: number;
    queryPort: number | null;
    isDefault: boolean;
    isActive: boolean;
    order: number;
    createdAt: Date;
}

const db = { servers: [] as ServerRow[] };

/**
 * Statuses are cached by server id for twenty seconds, which is right in
 * production and would otherwise leak one test's answer into the next. Ids
 * never repeat across this file.
 */
let nextId = 1;

const prismaMock = {
    gameServer: {
        findMany: vi.fn(async () =>
            db.servers.filter((s) => s.isActive).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
        ),
    },
};

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }, prisma: prismaMock }));

const { getServerStatus, getAllServerStatuses, isQueryable, connectAddress } = await import(
    "@/modules/servers/lib/server-query"
);

function server(overrides: Partial<ServerRow> = {}): ServerRow {
    return {
        id: `s${nextId++}`,
        name: "Server",
        type: "minecraft",
        host: "127.0.0.1",
        port: 0,
        queryPort: null,
        isDefault: false,
        isActive: true,
        order: 0,
        createdAt: new Date(),
        ...overrides,
    };
}

// ── A Minecraft server that answers one status ping ─────────────────────────

function writeVarInt(value: number): Buffer {
    const bytes: number[] = [];
    let remaining = value;
    do {
        let byte = remaining & 0x7f;
        remaining >>>= 7;
        if (remaining !== 0) byte |= 0x80;
        bytes.push(byte);
    } while (remaining !== 0);
    return Buffer.from(bytes);
}

function mcResponse(payload: unknown): Buffer {
    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const body = Buffer.concat([writeVarInt(0x00), writeVarInt(json.length), json]);
    return Buffer.concat([writeVarInt(body.length), body]);
}

const closers: Array<() => void> = [];

async function fakeMinecraft(payload: unknown, options: { split?: boolean } = {}): Promise<number> {
    const srv = net.createServer((socket) => {
        socket.once("data", () => {
            const response = mcResponse(payload);
            if (options.split) {
                // Real servers answer across several TCP segments, and the
                // reader has to wait for the whole packet before parsing.
                socket.write(response.subarray(0, 4));
                setTimeout(() => socket.write(response.subarray(4)), 10);
            } else {
                socket.write(response);
            }
        });
    });
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    closers.push(() => srv.close());
    return (srv.address() as net.AddressInfo).port;
}

// ── A Source server that answers A2S_INFO ───────────────────────────────────

function a2sInfo(name: string, map: string, game: string, players: number, max: number): Buffer {
    const str = (v: string) => Buffer.concat([Buffer.from(v, "utf8"), Buffer.from([0])]);
    return Buffer.concat([
        Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 17]),
        str(name),
        str(map),
        str("rust"),
        str(game),
        Buffer.from([0x00, 0x00]),
        Buffer.from([players, max, 0]),
    ]);
}

async function fakeSource(
    payload: Buffer,
    options: { challengeFirst?: boolean } = {},
): Promise<number> {
    const socket = dgram.createSocket("udp4");
    let asked = false;
    socket.on("message", (_msg, rinfo) => {
        if (options.challengeFirst && !asked) {
            asked = true;
            socket.send(
                Buffer.from([0xff, 0xff, 0xff, 0xff, 0x41, 0x11, 0x22, 0x33, 0x44]),
                rinfo.port,
                rinfo.address,
            );
            return;
        }
        socket.send(payload, rinfo.port, rinfo.address);
    });
    await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
    closers.push(() => socket.close());
    return socket.address().port;
}

beforeEach(() => {
    db.servers = [];
    vi.clearAllMocks();
});

afterEach(() => {
    while (closers.length) closers.pop()!();
});

describe("isQueryable", () => {
    it("knows the games it can ask", () => {
        for (const type of ["minecraft", "fivem", "rust", "ark", "cs2", "csgo", "garrysmod", "unturned"]) {
            expect(isQueryable(type), type).toBe(true);
        }
    });

    // Hytale ships no query protocol, and the community mods add RCON rather
    // than a status port. Saying so beats a permanent "offline".
    it("admits it cannot ask Hytale", () => {
        expect(isQueryable("hytale")).toBe(false);
    });

    it("does not care how the type was capitalised", () => {
        expect(isQueryable("Minecraft")).toBe(true);
    });
});

describe("Minecraft", () => {
    it("reads players, version and description off a live ping", async () => {
        const port = await fakeMinecraft({
            version: { name: "1.21.4" },
            players: { online: 12, max: 60 },
            description: "A Minecraft Server",
        });
        db.servers.push(server({ port, isDefault: true }));

        await expect(getServerStatus()).resolves.toEqual({
            online: true,
            players: { online: 12, max: 60 },
            version: "1.21.4",
            motd: "A Minecraft Server",
        });
    });

    it("waits for a response that arrives in pieces", async () => {
        const port = await fakeMinecraft(
            { version: { name: "1.20" }, players: { online: 1, max: 2 }, description: "Split" },
            { split: true },
        );
        db.servers.push(server({ port, isDefault: true }));
        await expect(getServerStatus()).resolves.toMatchObject({ online: true, motd: "Split" });
    });

    // Servers send their MOTD as a tree of chat components as often as a
    // string, and the colour codes are noise in a status widget.
    it("flattens a chat component description and drops colour codes", async () => {
        const port = await fakeMinecraft({
            version: { name: "1.21" },
            players: { online: 0, max: 20 },
            description: { text: "§aWelcome ", extra: [{ text: "home" }] },
        });
        db.servers.push(server({ port, isDefault: true }));
        await expect(getServerStatus()).resolves.toMatchObject({ motd: "Welcome home" });
    });

    it("reports a server that is not listening as down, without throwing", async () => {
        db.servers.push(server({ port: 1, isDefault: true }));
        await expect(getServerStatus()).resolves.toEqual({
            online: false,
            players: { online: 0, max: 0 },
            version: "",
            motd: "",
        });
    });
});

describe("Source games", () => {
    it("reads an A2S_INFO reply", async () => {
        const port = await fakeSource(a2sInfo("Rust EU", "Procedural Map", "Rust", 87, 200));
        db.servers.push(server({ type: "rust", queryPort: port, port: 28015, isDefault: true }));

        await expect(getServerStatus()).resolves.toEqual({
            online: true,
            players: { online: 87, max: 200 },
            version: "Rust",
            motd: "Rust EU (Procedural Map)",
        });
    });

    // Source servers answer the first query with a challenge and expect it
    // echoed back. A client that does not handle that sees every server down.
    it("answers the challenge a Source server sends back", async () => {
        const port = await fakeSource(a2sInfo("CS2", "de_dust2", "Counter-Strike 2", 9, 10), {
            challengeFirst: true,
        });
        db.servers.push(server({ type: "cs2", queryPort: port, isDefault: true }));
        await expect(getServerStatus()).resolves.toMatchObject({
            online: true,
            players: { online: 9, max: 10 },
        });
    });

    it("falls back to the game port when no query port is set", async () => {
        const port = await fakeSource(a2sInfo("Gmod", "gm_flatgrass", "Garry's Mod", 3, 32));
        db.servers.push(server({ type: "garrysmod", port, queryPort: null, isDefault: true }));
        await expect(getServerStatus()).resolves.toMatchObject({ online: true });
    });
});

describe("every server at once", () => {
    it("answers for each server in its own protocol", async () => {
        const mc = await fakeMinecraft({
            version: { name: "1.21" },
            players: { online: 4, max: 40 },
            description: "MC",
        });
        const rust = await fakeSource(a2sInfo("Rust", "Map", "Rust", 5, 50));

        db.servers.push(server({ name: "Survival", port: mc, isDefault: true }));
        db.servers.push(server({ name: "Rust EU", type: "rust", queryPort: rust }));
        db.servers.push(server({ name: "Hytale", type: "hytale", port: 1 }));

        const statuses = await getAllServerStatuses();
        expect(statuses).toHaveLength(3);
        expect(statuses[0]).toMatchObject({ name: "Survival", online: true, players: { online: 4 } });
        expect(statuses[1]).toMatchObject({ name: "Rust EU", online: true, players: { online: 5 } });
        // Not asked at all, and honest about it rather than reported as down.
        expect(statuses[2]).toMatchObject({ name: "Hytale", queryable: false, online: false });
    });

    it("leaves out the servers an admin disabled", async () => {
        db.servers.push(server({ port: 1, isDefault: true }));
        db.servers.push(server({ port: 1, isActive: false }));
        await expect(getAllServerStatuses()).resolves.toHaveLength(1);
    });

    it("says where a player connects, the way a game client wants it typed", async () => {
        // A Minecraft client fills in 25565 by itself, so the address a player
        // is told to type leaves it off; any other port has to be written.
        // Hytale is never asked, so its host can be anything; the Minecraft
        // and FiveM ones point at loopback ports nothing listens on, and are
        // refused at once.
        db.servers.push(server({ name: "Lobby", host: "play.example.com", port: 25565, isDefault: true, type: "hytale" }));
        db.servers.push(server({ name: "Survival", host: "localhost", port: 25565 }));
        const statuses = await getAllServerStatuses();
        expect(statuses[0].address).toBe("play.example.com:25565");
        expect(connectAddress("minecraft", "play.example.com", 25565)).toBe("play.example.com");
        expect(connectAddress("minecraft", "play.example.com", 25566)).toBe("play.example.com:25566");
        expect(connectAddress("fivem", "203.0.113.7", 30120)).toBe("203.0.113.7:30120");
    });

    it("never publishes an address on the operator's own network", async () => {
        // A network registers its backend servers by their inside address so
        // this module can ask them; players reach them through a proxy. Told
        // to the world, that address is a map of the operator's network.
        for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "172.16.4.2", "172.31.255.1", "192.168.1.20", "169.254.3.3", "::1", "[::1]", "fd12:3456::1", "fe80::1", "backend.local", "0.0.0.0"]) {
            expect(connectAddress("minecraft", host, 25565), host).toBeNull();
        }
        for (const host of ["172.32.0.1", "11.0.0.1", "play.example.com", "2001:db8::1"]) {
            expect(connectAddress("minecraft", host, 25565), host).not.toBeNull();
        }
    });

    it("reports nothing rather than failing when no server is configured", async () => {
        await expect(getAllServerStatuses()).resolves.toEqual([]);
        await expect(getServerStatus()).resolves.toMatchObject({ online: false });
    });
});
