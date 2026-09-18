// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A punishment happened somewhere, and where decides what it costs.
 *
 * The record had one idea of "where": which module reported it. That answers a
 * different question. An operator running Survival and Skyblock off one server
 * wants them apart on the list; an operator running a Minecraft server and a
 * CS:GO server wants those apart; and nearly everyone wants a ban handed down
 * in a game kept apart from what this website does about it.
 *
 * So a scope is the operator's own list, named by them, and each one says
 * whether a punishment recorded in it also restricts this website. That last
 * flag is the whole point: a Skyblock ban should not have to close somebody's
 * forum account, and a Survival ban might be exactly that.
 *
 * A punishment with no scope keeps restricting, which is what every row
 * written before this existed is, and what an administrator issuing one here
 * means.
 */

const rows: { value: { type: string; expiresAt: Date | null; scope: { restrictsSite: boolean } | null }[] } = { value: [] };
const queries: Record<string, unknown>[] = [];

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        punishment: {
            findMany: async (args: Record<string, unknown>) => {
                queries.push(args);
                return rows.value;
            },
        },
    },
}));

const CLEAR = { mayEnter: true, mayWrite: true, until: null, reasonKey: null };

async function standing() {
    const handler = (await import("../../../module-sources/punishments/hooks/standing")).default;
    return handler(CLEAR as never, { userId: "u1" } as never);
}

beforeEach(() => {
    rows.value = [];
    queries.length = 0;
    vi.resetModules();
});

describe("a scope says where a rule applies", () => {
    it("closes the account for a ban in a scope that restricts this site", async () => {
        rows.value = [{ type: "ban", expiresAt: null, scope: { restrictsSite: true } }];

        expect(await standing()).toMatchObject({ mayEnter: false });
    });

    it("leaves the site alone for a ban in a scope that does not", async () => {
        // A Skyblock ban. They are still a member here.
        rows.value = [{ type: "ban", expiresAt: null, scope: { restrictsSite: false } }];

        expect(await standing()).toMatchObject({ mayEnter: true, mayWrite: true });
    });

    it("restricts an unscoped punishment, because that is what every old row is", async () => {
        rows.value = [{ type: "mute", expiresAt: null, scope: null }];

        expect((await standing()).mayWrite).toBe(false);
    });

    it("takes the strictest answer when scopes disagree", async () => {
        rows.value = [
            { type: "ban", expiresAt: null, scope: { restrictsSite: false } },
            { type: "mute", expiresAt: null, scope: { restrictsSite: true } },
        ];

        const answer = await standing();

        // The Skyblock ban costs nothing here; the Survival mute still bites.
        expect(answer.mayEnter).toBe(true);
        expect(answer.mayWrite).toBe(false);
    });

    it("reads the scope in the same query, not one per row", async () => {
        rows.value = [{ type: "ban", expiresAt: null, scope: null }];
        await standing();

        // This runs on the sign-in path. A query per punishment would put a
        // round trip per row between a member and their own front page.
        expect(queries).toHaveLength(1);
        expect(JSON.stringify(queries[0])).toContain("restrictsSite");
    });
});
