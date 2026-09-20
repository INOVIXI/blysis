// @vitest-environment node
/**
 * The screen that manages game servers shows every server.
 *
 * `GET /api/v1/servers` is what the status widget asks, so it answers
 * `isActive: true`. The panel read the same answer, which means the switch
 * labelled "Active" removes the row from the only screen that can switch it
 * back on. An operator who takes a server down for the season has to go into
 * the database to get it back.
 *
 * `scope=admin` is the operator's answer: every server, in the order they are
 * drawn in, still without the RCON password or the port it opens - those are
 * withheld from every response for the reason written in `server-fields.ts`,
 * and an operator's screen is still a response.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const queries: Record<string, unknown>[] = [];
const session: { value: { user: { id: string } } | null } = { value: null };
const admin = { value: false };

vi.mock("@/core/sdk/server", () => ({
    isAdmin: async () => admin.value,
    encryptSecret: (value: string) => value,
    readJsonBody: async () => ({}),
    prisma: {
        gameServer: {
            findMany: async (args: Record<string, unknown>) => {
                queries.push(args);
                return [];
            },
        },
    },
}));

vi.mock("@/core/sdk/auth", () => ({ auth: async () => session.value }));

async function get(url: string) {
    const { GET } = await import("../../../module-sources/servers/api/route");
    return GET(new Request(url) as never);
}

beforeEach(() => {
    queries.length = 0;
    session.value = null;
    admin.value = false;
    vi.resetModules();
});

describe("what the status widget is shown", () => {
    it("is the servers that are on", async () => {
        await get("https://example.com/api/v1/servers");
        expect(queries[0].where).toMatchObject({ isActive: true });
    });
});

describe("what the operator's screen is shown", () => {
    it("is every server, including the ones turned off", async () => {
        session.value = { user: { id: "u1" } };
        admin.value = true;

        const res = await get("https://example.com/api/v1/servers?scope=admin");

        expect(res.status).toBe(200);
        expect(queries[0].where ?? {}).toEqual({});
    });

    it("keeps the order the operator put them in", async () => {
        session.value = { user: { id: "u1" } };
        admin.value = true;
        await get("https://example.com/api/v1/servers?scope=admin");
        expect(queries[0].orderBy).toEqual({ order: "asc" });
    });

    it("still withholds the RCON password and the port it opens", async () => {
        session.value = { user: { id: "u1" } };
        admin.value = true;
        await get("https://example.com/api/v1/servers?scope=admin");
        const select = queries[0].select as Record<string, boolean>;
        expect(select.rconPassword).toBeUndefined();
        expect(select.rconPort).toBeUndefined();
    });

    it("is refused to a visitor, who would be reading a host the operator hid", async () => {
        const res = await get("https://example.com/api/v1/servers?scope=admin");
        expect(res.status).toBe(401);
        expect(queries).toHaveLength(0);
    });

    it("is refused to a member who is not an operator", async () => {
        session.value = { user: { id: "u2" } };
        const res = await get("https://example.com/api/v1/servers?scope=admin");
        expect(res.status).toBe(403);
        expect(queries).toHaveLength(0);
    });
});
