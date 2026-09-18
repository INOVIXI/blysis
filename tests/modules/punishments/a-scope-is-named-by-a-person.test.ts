// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * How a reported punishment finds the scope it belongs to.
 *
 * A reporter names a key rather than a scope: LiteBans says `server_scope`,
 * which on a real server is a string like `skyblock` or `srv-2`. That is the
 * other system's word for the place, and it is not a name anybody chose to
 * show anyone.
 *
 * So the key is matched against the scopes the operator made, and a key
 * nothing matches leaves the punishment unscoped rather than inventing a
 * scope out of it. Auto-creating one would put `srv-2` on a public list under
 * a column header, which is the thing 11a exists to stop - and the operator
 * would then have to find and rename it.
 *
 * The key is kept on the row even when nothing matched, so the admin screen
 * can offer what has actually been arriving, and so a scope made later can
 * claim the rows that were waiting for it.
 */

const scopes: { value: { id: string; matchKey: string | null }[] } = { value: [] };
const written: Record<string, unknown>[] = [];

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        punishmentScope: {
            findFirst: async ({ where }: { where: { matchKey: string } }) =>
                scopes.value.find((s) => s.matchKey === where.matchKey) ?? null,
        },
        punishment: {
            findUnique: async () => null,
            upsert: async (args: { create: Record<string, unknown> }) => {
                written.push(args.create);
                return { id: "p1", ...args.create };
            },
        },
    },
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/core/sdk", () => ({ doActionAsync: async () => {} }));

const report = {
    source: "minecraft-litebans",
    externalRef: "ban:1",
    playerName: "aeryn",
    type: "ban",
};

async function record(extra: Record<string, unknown> = {}) {
    const handler = (await import("../../../module-sources/punishments/hooks/record")).default;
    return handler({ recorded: false, id: null } as never, { ...report, ...extra } as never);
}

beforeEach(() => {
    scopes.value = [];
    written.length = 0;
    vi.resetModules();
});

describe("a scope is named by a person, not by a game server", () => {
    it("files the punishment under the scope whose key the reporter named", async () => {
        scopes.value = [{ id: "s-sky", matchKey: "skyblock" }];

        await record({ scopeKey: "skyblock" });

        expect(written[0].scopeId).toBe("s-sky");
    });

    it("leaves it unscoped when no scope claims that key", async () => {
        scopes.value = [{ id: "s-sky", matchKey: "skyblock" }];

        await record({ scopeKey: "srv-2" });

        // Not invented. `srv-2` is the game server's word, not a name.
        expect(written[0].scopeId).toBeNull();
    });

    it("keeps the key anyway, so a scope made later can claim the row", async () => {
        await record({ scopeKey: "srv-2" });

        expect(written[0].scopeKey).toBe("srv-2");
    });

    it("records a punishment that names no scope at all", async () => {
        await record();

        expect(written[0].scopeId).toBeNull();
        expect(written[0].scopeKey).toBeNull();
    });

    it("does not ask the database when there is no key to ask about", async () => {
        await record();

        expect(written).toHaveLength(1);
    });
});
