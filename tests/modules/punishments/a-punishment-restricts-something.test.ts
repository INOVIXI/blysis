// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Which of the six kinds actually does something here.
 *
 * The module recorded six and enforced none, so the question had never been
 * asked out loud. Two of them mean something on a website and four do not, and
 * saying so in a test is the only way that stays true: a kick is a game server
 * throwing somebody off a server, and there is nothing here to throw them off
 * of.
 *
 * The rule that matters most is the one about who a punishment is against. A
 * row carries an in-game name, and a member only when somebody proved they own
 * that account. Restricting on the name would mean taking a username on a game
 * server was enough to silence whoever holds it here.
 */

/** Shaped like the real select, which always returns the scope, null or not. */
const rows: { value: { type: string; expiresAt: Date | null; scope: null }[] } = { value: [] };
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

async function standing(current = CLEAR, userId: string | null = "u1") {
    const handler = (await import("../../../module-sources/punishments/hooks/standing")).default;
    return handler(current as never, { userId } as never);
}

beforeEach(() => {
    rows.value = [];
    queries.length = 0;
    vi.resetModules();
});

describe("a punishment restricts something", () => {
    it("lets a member with a clean record do everything", async () => {
        expect(await standing()).toMatchObject({ mayEnter: true, mayWrite: true });
    });

    it("closes the account on a ban", async () => {
        rows.value = [{ type: "ban", expiresAt: null, scope: null }];

        expect(await standing()).toMatchObject({ mayEnter: false, mayWrite: false });
    });

    it("takes writing away on a mute and leaves the door open", async () => {
        rows.value = [{ type: "mute", expiresAt: null, scope: null }];

        const answer = await standing();

        expect(answer.mayWrite).toBe(false);
        // Still able to read, open a ticket and appeal. Taking that away would
        // be a ban by another name.
        expect(answer.mayEnter).toBe(true);
    });

    it("reads a spelling a game server plugin wrote", async () => {
        rows.value = [{ type: "tempmute", expiresAt: new Date(Date.now() + 3_600_000), scope: null }];

        expect((await standing()).mayWrite).toBe(false);
    });

    it("says when a temporary one lifts", async () => {
        const ends = new Date(Date.now() + 3_600_000);
        rows.value = [{ type: "tempMute", expiresAt: ends, scope: null }];

        expect((await standing()).until).toEqual(ends);
    });

    it("says nothing lifts when one of them is permanent", async () => {
        rows.value = [
            { type: "tempMute", expiresAt: new Date(Date.now() + 3_600_000), scope: null },
            { type: "mute", expiresAt: null, scope: null },
        ];

        expect((await standing()).until).toBeNull();
    });

    it("lets a ban outrank a mute in what the member is told", async () => {
        rows.value = [{ type: "mute", expiresAt: null, scope: null }, { type: "ban", expiresAt: null, scope: null }];

        expect((await standing()).reasonKey).toBe("punishments.standingBanned");
    });

    it("asks only about punishments against a member, never against a name", async () => {
        await standing();

        const where = queries[0].where as { userId: string; active: boolean };
        expect(where.userId).toBe("u1");
        expect(where.active).toBe(true);
    });

    it("does not ask at all about a reader who is not signed in", async () => {
        await standing(CLEAR, null);

        expect(queries).toEqual([]);
    });

    it("never asks about a kick or a warning, because neither restricts anything here", async () => {
        await standing();

        const where = queries[0].where as { type: { in: string[] } };
        expect(where.type.in).not.toContain("kick");
        expect(where.type.in).not.toContain("warning");
    });

    it("leaves an account core already closed exactly as it found it", async () => {
        const closed = { mayEnter: false, mayWrite: false, until: null, reasonKey: "standing.bannedHere" };

        expect(await standing(closed)).toEqual(closed);
        expect(queries).toEqual([]);
    });
});
