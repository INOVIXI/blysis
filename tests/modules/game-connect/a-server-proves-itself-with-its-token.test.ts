// @vitest-environment node
/**
 * A game server is its token, and only one process holds a token at a time.
 *
 * The token is the whole of a server's identity, so the site keeps only its
 * hash. Saying hello makes a process the token's current one, and any other
 * process using the same token is told it was superseded, which is what a
 * second server misconfigured with the same token has to hear.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

interface ServerRow {
    id: string;
    gameServerId: string;
    tokenHash: string;
    tokenHint: string;
    enabled: boolean;
    instance: string | null;
    instanceSeenAt: Date | null;
    previousInstance: string | null;
    previousSeenAt: Date | null;
    [key: string]: unknown;
}

const db = { servers: [] as ServerRow[] };

const prismaMock = {
    gameConnectServer: {
        findUnique: vi.fn(async ({ where }: { where: { tokenHash?: string; id?: string } }) =>
            db.servers.find((s) => (where.tokenHash ? s.tokenHash === where.tokenHash : s.id === where.id)) ?? null,
        ),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ServerRow> }) => {
            const row = db.servers.find((s) => s.id === where.id)!;
            Object.assign(row, data);
            return row;
        }),
    },
    gameServer: {
        findUnique: vi.fn(async () => ({ name: "Survival" })),
    },
};

vi.mock("@/core/sdk/server", () => ({
    prisma: prismaMock,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => ({})),
    readJsonBody: async (request: Request) => request.json(),
    readSettingStrings: vi.fn(async () => ({ site_name: "Example" })),
    resolveAppName: () => "Blysis",
    resolveAppUrl: () => "https://example.com",
}));

vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (_hook: string, value: unknown) => value),
}));

const { issueToken, hashToken, bearerToken } = await import("@/modules/game-connect/lib/token");
const { authenticateServer, requireCurrentInstance } = await import("@/modules/game-connect/lib/auth");
const { POST: hello } = await import("@/modules/game-connect/api/hello/route");

function addServer(token: string, extra: Partial<ServerRow> = {}): ServerRow {
    const row: ServerRow = {
        id: `s${db.servers.length + 1}`,
        gameServerId: `g${db.servers.length + 1}`,
        tokenHash: hashToken(token),
        tokenHint: token.slice(-4),
        enabled: true,
        instance: null,
        instanceSeenAt: null,
        previousInstance: null,
        previousSeenAt: null,
        ...extra,
    };
    db.servers.push(row);
    return row;
}

function request(token: string | null, body: unknown = {}, protocol: string | null = "1"): NextRequest {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (protocol) headers["x-game-connect-protocol"] = protocol;
    return new NextRequest("https://example.com/api/v1/game-connect/hello", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
}

const helloBody = (instance: string) => ({
    instance,
    client: { name: "blysis-connect-minecraft", version: "1.0.0" },
    game: "minecraft",
    software: { name: "Paper", version: "26.2" },
    role: "server",
});

beforeEach(() => {
    db.servers = [];
    vi.clearAllMocks();
});

describe("a token", () => {
    it("is gc_ and 43 url-safe characters", () => {
        expect(issueToken().token).toMatch(/^gc_[A-Za-z0-9_-]{43}$/);
    });

    it("is stored as its hash, never as itself", () => {
        const issued = issueToken();
        expect(issued.hash).toBe(hashToken(issued.token));
        expect(issued.hash).not.toContain(issued.token);
        expect(issued.hint).toBe(issued.token.slice(-4));
    });

    it("is read only out of a bearer header of the right shape", () => {
        const { token } = issueToken();
        expect(bearerToken(`Bearer ${token}`)).toBe(token);
        expect(bearerToken(`Basic ${token}`)).toBeNull();
        expect(bearerToken("Bearer gc_short")).toBeNull();
        expect(bearerToken(null)).toBeNull();
    });
});

describe("authenticating a server", () => {
    it("lets the holder of a known token in", async () => {
        const { token } = issueToken();
        const row = addServer(token);
        await expect(authenticateServer(request(token))).resolves.toBe(row);
    });

    it("turns away a token nobody holds with 401", async () => {
        addServer(issueToken().token);
        const answer = await authenticateServer(request(issueToken().token));
        expect((answer as Response).status).toBe(401);
        await expect((answer as Response).json()).resolves.toMatchObject({ code: "token_invalid" });
    });

    it("asks for a protocol it speaks before it looks at the token", async () => {
        const { token } = issueToken();
        addServer(token);
        const missing = (await authenticateServer(request(token, {}, null))) as Response;
        const future = (await authenticateServer(request(token, {}, "9"))) as Response;
        expect(missing.status).toBe(426);
        expect(future.status).toBe(426);
        await expect(future.json()).resolves.toMatchObject({ code: "protocol_unsupported", supported: [1] });
    });

    it("turns away a server an admin switched off", async () => {
        const { token } = issueToken();
        addServer(token, { enabled: false });
        const answer = (await authenticateServer(request(token))) as Response;
        expect(answer.status).toBe(403);
    });
});

describe("hello", () => {
    it("makes the caller the token's current process", async () => {
        const { token } = issueToken();
        const row = addServer(token);
        const answer = await hello(request(token, helloBody("instance-a")));
        expect(answer.status).toBe(200);
        expect(row.instance).toBe("instance-a");
        const body = await answer.json();
        expect(body.server).toEqual({ id: row.gameServerId, name: "Survival" });
        expect(body.settings).toMatchObject({ pollHoldSeconds: 25, statusIntervalSeconds: 30, leaseSeconds: 120 });
        expect(body.settings.catalogVersion).toMatch(/^c-[0-9a-f]{16}$/);
        expect(body.takeover).toBeNull();
    });

    it("says so when it took the token from a process that was still live", async () => {
        const { token } = issueToken();
        addServer(token, { instance: "instance-a", instanceSeenAt: new Date(Date.now() - 5_000) });
        const body = await (await hello(request(token, helloBody("instance-b")))).json();
        expect(body.takeover).toMatchObject({ previousInstance: "instance-a" });
    });

    it("says nothing about a process that had long gone quiet", async () => {
        const { token } = issueToken();
        addServer(token, { instance: "instance-a", instanceSeenAt: new Date(Date.now() - 600_000) });
        const body = await (await hello(request(token, helloBody("instance-b")))).json();
        expect(body.takeover).toBeNull();
    });

    it("refuses a body that does not say who it is", async () => {
        const { token } = issueToken();
        addServer(token);
        const answer = await hello(request(token, { instance: "x" }));
        expect(answer.status).toBe(422);
    });
});

describe("a superseded process", () => {
    it("is told on its next call", async () => {
        const { token } = issueToken();
        const row = addServer(token);
        await hello(request(token, helloBody("instance-a")));
        await hello(request(token, helloBody("instance-b")));
        const answer = await requireCurrentInstance(row as never, "instance-a");
        expect(answer?.status).toBe(409);
        await expect(answer?.json()).resolves.toMatchObject({ code: "superseded" });
        await expect(requireCurrentInstance(row as never, "instance-b")).resolves.toBeNull();
    });
});
