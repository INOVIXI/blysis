/**
 * Asking a game server whether it is up, and who is on it.
 *
 * This used to ask mcsrvstat.us about a single host kept in the settings
 * table. That was wrong twice over: it could only ever describe one server,
 * and the answer was always a Minecraft answer, so a site with a Rust server
 * showed "offline" forever. Status now reads the same `GameServer` rows the
 * admin panel edits and speaks the protocol the server actually speaks.
 *
 * Three protocols cover every type the panel offers:
 *   - Minecraft's Server List Ping, the handshake a client sends before it
 *     shows a server in its list.
 *   - A2S_INFO over UDP, which every Source engine game answers (Rust, ARK,
 *     CS2, Garry's Mod, Unturned).
 *   - FiveM's `/dynamic.json`, which its server exposes over plain HTTP.
 *
 * No third party sits in the middle any more. The host is infrastructure an
 * administrator configured, the same host RCON already dials, so there is no
 * user-supplied address here and nothing to guard against: the old private-IP
 * block only made sense while the address was being handed to someone else,
 * and it broke the most ordinary setup there is, a game server on the same
 * machine as the site.
 */
import net from "net";
import dgram from "dgram";
import { prisma } from "@/core/sdk/server";
import { isPrivateHost } from "@/core/sdk";

export interface ServerStatus {
    online: boolean;
    players: { online: number; max: number };
    version: string;
    motd: string;
}

export interface ServerQueryResult extends ServerStatus {
    id: string;
    name: string;
    type: string;
    /** False when we have no way to ask this kind of server anything. */
    queryable: boolean;
    /** Where a player connects, written the way their game client wants it typed; null when it is not to be published. */
    address: string | null;
    description: string | null;
    image: string | null;
}

/** The port a game's client fills in by itself when a player types none. */
const CLIENT_DEFAULT_PORT: Record<string, number> = { minecraft: 25565 };

/**
 * The address a player is told to type, or null when it must not be told.
 *
 * Only the game port is ever part of it: the query port is a door for this
 * module, not for players. And an address inside the operator's network is
 * never published: a network registers its backend servers that way so they
 * can be asked, players reach them through a proxy, and the inside address
 * told to the world is a map of the operator's network.
 */
export function connectAddress(type: string, host: string, port: number): string | null {
    const bare = host.trim();
    const v6 = bare.includes(":") ? (bare.startsWith("[") ? bare : `[${bare}]`) : null;
    if (!bare || isPrivateHost(v6 ?? bare)) return null;
    const shown = v6 ?? bare;
    return CLIENT_DEFAULT_PORT[type.toLowerCase()] === port ? shown : `${shown}:${port}`;
}

interface GameServerRow {
    id: string;
    name: string;
    type: string;
    host: string;
    port: number;
    queryPort: number | null;
    isDefault: boolean;
    description?: string | null;
    image?: string | null;
}

const OFFLINE: ServerStatus = {
    online: false,
    players: { online: 0, max: 0 },
    version: "",
    motd: "",
};

/** A server that does not answer in this long is treated as down. */
const TIMEOUT_MS = 2500;

/**
 * Statuses are cached briefly. A busy front page can render the server list
 * many times a minute, and a game server should not be dialled once per
 * visitor.
 */
const CACHE_TTL_MS = 20_000;
const cache = new Map<string, { at: number; status: ServerStatus }>();

// ---------------------------------------------------------------------------
// Protocol: Minecraft Server List Ping
// ---------------------------------------------------------------------------

function writeVarInt(value: number): Buffer {
    const bytes: number[] = [];
    // `>>>` on the shift below reads the value as unsigned, which is what
    // makes a negative number encode as its two's complement.
    let remaining = value;
    do {
        let byte = remaining & 0x7f;
        remaining >>>= 7;
        if (remaining !== 0) byte |= 0x80;
        bytes.push(byte);
    } while (remaining !== 0);
    return Buffer.from(bytes);
}

function readVarInt(buffer: Buffer, offset: number): { value: number; size: number } | null {
    let value = 0;
    let size = 0;
    while (true) {
        if (offset + size >= buffer.length) return null;
        const byte = buffer[offset + size];
        value |= (byte & 0x7f) << (7 * size);
        size += 1;
        if ((byte & 0x80) === 0) break;
        // A varint longer than five bytes is not a length, it is garbage.
        if (size >= 5) return null;
    }
    return { value, size };
}

function packet(id: number, payload: Buffer): Buffer {
    const body = Buffer.concat([writeVarInt(id), payload]);
    return Buffer.concat([writeVarInt(body.length), body]);
}

function mcString(value: string): Buffer {
    const encoded = Buffer.from(value, "utf8");
    return Buffer.concat([writeVarInt(encoded.length), encoded]);
}

/**
 * Flattens the chat component a server sends as its description. It can be a
 * plain string, or a tree of `{text, extra}` nodes, and both spellings appear
 * in the wild depending on the server software.
 */
function flattenMotd(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(flattenMotd).join("");
    if (value && typeof value === "object") {
        const node = value as { text?: unknown; extra?: unknown };
        return `${flattenMotd(node.text ?? "")}${flattenMotd(node.extra ?? "")}`;
    }
    return "";
}

function stripColorCodes(motd: string): string {
    return motd.replace(/§[0-9a-fk-or]/gi, "").trim();
}

function queryMinecraft(host: string, port: number): Promise<ServerStatus> {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port });
        const chunks: Buffer[] = [];
        let settled = false;

        const finish = (status: ServerStatus) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(status);
        };

        socket.setTimeout(TIMEOUT_MS);
        socket.on("timeout", () => finish(OFFLINE));
        socket.on("error", () => finish(OFFLINE));

        socket.on("connect", () => {
            const handshake = packet(
                0x00,
                Buffer.concat([
                    // -1 asks the server to answer with whatever it speaks
                    // rather than refusing a version it does not know. It is a
                    // two's complement varint, so it takes all five bytes.
                    writeVarInt(-1),
                    mcString(host),
                    (() => {
                        const b = Buffer.alloc(2);
                        b.writeUInt16BE(port);
                        return b;
                    })(),
                    writeVarInt(1),
                ]),
            );
            socket.write(handshake);
            socket.write(packet(0x00, Buffer.alloc(0)));
        });

        socket.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
            const buffer = Buffer.concat(chunks);

            const length = readVarInt(buffer, 0);
            if (!length) return;
            const id = readVarInt(buffer, length.size);
            if (!id) return;
            const json = readVarInt(buffer, length.size + id.size);
            if (!json) return;

            const start = length.size + id.size + json.size;
            // The response arrives in several TCP segments; wait for all of it.
            if (buffer.length < start + json.value) return;

            try {
                const parsed = JSON.parse(buffer.subarray(start, start + json.value).toString("utf8")) as {
                    version?: { name?: string };
                    players?: { online?: number; max?: number };
                    description?: unknown;
                };
                finish({
                    online: true,
                    players: {
                        online: parsed.players?.online ?? 0,
                        max: parsed.players?.max ?? 0,
                    },
                    version: parsed.version?.name ?? "",
                    motd: stripColorCodes(flattenMotd(parsed.description)),
                });
            } catch {
                finish(OFFLINE);
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Protocol: A2S_INFO (Source engine)
// ---------------------------------------------------------------------------

const A2S_HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const A2S_INFO_PAYLOAD = Buffer.concat([
    A2S_HEADER,
    Buffer.from("T"),
    Buffer.from("Source Engine Query\0", "ascii"),
]);

/** Reads a null-terminated string, returning it and where it ended. */
function readCString(buffer: Buffer, offset: number): { value: string; next: number } {
    const end = buffer.indexOf(0, offset);
    const stop = end === -1 ? buffer.length : end;
    return { value: buffer.subarray(offset, stop).toString("utf8"), next: stop + 1 };
}

function parseA2sInfo(buffer: Buffer): ServerStatus | null {
    // 4 bytes of 0xFF, then 'I' for an info reply, then the protocol byte.
    if (buffer.length < 6 || buffer.readUInt8(4) !== 0x49) return null;
    let offset = 6;
    const name = readCString(buffer, offset);
    offset = name.next;
    const map = readCString(buffer, offset);
    offset = map.next;
    const folder = readCString(buffer, offset);
    offset = folder.next;
    const game = readCString(buffer, offset);
    offset = game.next;
    // App id (2 bytes), then players, max players, bots.
    if (offset + 5 > buffer.length) return null;
    offset += 2;
    const players = buffer.readUInt8(offset);
    const max = buffer.readUInt8(offset + 1);

    return {
        online: true,
        players: { online: players, max },
        version: game.value,
        motd: `${name.value}${map.value ? ` (${map.value})` : ""}`,
    };
}

function queryA2S(host: string, port: number): Promise<ServerStatus> {
    return new Promise((resolve) => {
        const socket = dgram.createSocket("udp4");
        let settled = false;
        let challenged = false;

        const finish = (status: ServerStatus) => {
            if (settled) return;
            settled = true;
            try {
                socket.close();
            } catch {
                /* already closed */
            }
            resolve(status);
        };

        const timer = setTimeout(() => finish(OFFLINE), TIMEOUT_MS);
        timer.unref?.();

        socket.on("error", () => {
            clearTimeout(timer);
            finish(OFFLINE);
        });

        socket.on("message", (message) => {
            // 'A' means "prove you are there": resend the query with the
            // challenge appended. Servers only ask once, so a second challenge
            // is a loop we refuse to enter.
            if (message.length >= 9 && message.readUInt8(4) === 0x41) {
                if (challenged) {
                    clearTimeout(timer);
                    finish(OFFLINE);
                    return;
                }
                challenged = true;
                const withChallenge = Buffer.concat([A2S_INFO_PAYLOAD, message.subarray(5, 9)]);
                socket.send(withChallenge, port, host, (err) => {
                    if (err) {
                        clearTimeout(timer);
                        finish(OFFLINE);
                    }
                });
                return;
            }

            clearTimeout(timer);
            finish(parseA2sInfo(message) ?? OFFLINE);
        });

        socket.send(A2S_INFO_PAYLOAD, port, host, (err) => {
            if (err) {
                clearTimeout(timer);
                finish(OFFLINE);
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Protocol: FiveM
// ---------------------------------------------------------------------------

async function queryFivem(host: string, port: number): Promise<ServerStatus> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const response = await fetch(`http://${host}:${port}/dynamic.json`, {
            signal: controller.signal,
            cache: "no-store",
        });
        clearTimeout(timer);
        if (!response.ok) return OFFLINE;

        const data = (await response.json()) as {
            clients?: number;
            sv_maxclients?: number | string;
            hostname?: string;
            gametype?: string;
            mapname?: string;
        };
        return {
            online: true,
            players: {
                online: Number(data.clients ?? 0),
                max: Number(data.sv_maxclients ?? 0),
            },
            version: data.gametype ?? "",
            motd: stripColorCodes(data.hostname ?? ""),
        };
    } catch {
        return OFFLINE;
    }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Every type the admin panel offers, and how to ask it. */
const SOURCE_TYPES = new Set(["rust", "ark", "csgo", "cs2", "garrysmod", "unturned", "source"]);

/**
 * Hytale is the honest gap: it ships no query protocol, and the community
 * mods that add remote access add RCON, not a status port. Saying so beats
 * showing a permanent "offline".
 */
export function isQueryable(type: string): boolean {
    const kind = type.toLowerCase();
    return kind === "minecraft" || kind === "fivem" || SOURCE_TYPES.has(kind);
}

async function queryServer(server: GameServerRow): Promise<ServerStatus> {
    const type = server.type.toLowerCase();
    // Source games answer on their query port, which is usually not the port
    // players connect to. Minecraft answers on the game port itself.
    const port = SOURCE_TYPES.has(type) ? server.queryPort ?? server.port : server.port;

    if (type === "minecraft") return queryMinecraft(server.host, port);
    if (type === "fivem") return queryFivem(server.host, server.queryPort ?? server.port);
    if (SOURCE_TYPES.has(type)) return queryA2S(server.host, port);
    return OFFLINE;
}

async function cachedQuery(server: GameServerRow): Promise<ServerStatus> {
    const hit = cache.get(server.id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.status;

    const status = await queryServer(server);
    cache.set(server.id, { at: Date.now(), status });
    return status;
}

async function activeServers(): Promise<GameServerRow[]> {
    return prisma.gameServer.findMany({
        where: { isActive: true },
        orderBy: [{ isDefault: "desc" }, { order: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, type: true, host: true, port: true, queryPort: true, isDefault: true, description: true, image: true },
    });
}

/** Every active server, asked in parallel. One slow host must not hold up the rest. */
export async function getAllServerStatuses(): Promise<ServerQueryResult[]> {
    const servers = await activeServers();
    return Promise.all(
        servers.map(async (server) => ({
            id: server.id,
            name: server.name,
            type: server.type,
            queryable: isQueryable(server.type),
            address: connectAddress(server.type, server.host, server.port),
            description: server.description ?? null,
            image: server.image ?? null,
            ...(isQueryable(server.type) ? await cachedQuery(server) : OFFLINE),
        })),
    );
}

/**
 * The default server on its own, in the flat shape the public endpoint has
 * always returned. Kept so a theme or a script written against the old
 * response keeps working.
 */
export async function getServerStatus(): Promise<ServerStatus> {
    const servers = await activeServers();
    const server = servers[0];
    if (!server || !isQueryable(server.type)) return OFFLINE;
    return cachedQuery(server);
}
