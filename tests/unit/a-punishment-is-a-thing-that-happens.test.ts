import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Three systems called themselves punishment and none of them punished.
 *
 * The punishments module kept a record - bans, mutes, kicks, warnings, with
 * reasons and durations - that nothing outside its own two screens ever read.
 * A member with an active mute against their name posted in the forum. A
 * member with a permanent ban signed in. It was a list.
 *
 * Core kept `UserWarning`, with points and thresholds and a `user.warning.
 * threshold` action whose own comment promised "auto-mute at 5 points,
 * auto-ban at 10". Nothing listened to it. It was a counter.
 *
 * And core kept `User.isBanned`, which really did refuse a sign-in, and which
 * knew nothing about either of the other two: twelve bans on the record and
 * the account still opened.
 *
 * So there is one question now and one place that answers it. Core asks what a
 * member may do; modules answer by restricting; core enforces. A module cannot
 * grant - a punishment record that could hand back a sign-in would be a way to
 * unban somebody by writing a row - so every answer is an AND.
 */

const filterResult: { value: unknown } = { value: undefined };
const userRow: { value: { isBanned: boolean } | null } = { value: { isBanned: false } };

vi.mock("@/core/lib/db", () => ({
    prisma: { user: { findUnique: async () => userRow.value } },
}));

vi.mock("@/core/lib/hooks", () => ({
    applyFiltersAsync: async (_hook: string, fallback: unknown) => filterResult.value ?? fallback,
}));

vi.mock("@/core/lib/hooks-bootstrap", () => ({ ensureHooks: async () => {} }));

async function standing(userId = "u1") {
    const { memberStanding } = await import("@/core/lib/member-standing");
    return memberStanding(userId);
}

beforeEach(() => {
    filterResult.value = undefined;
    userRow.value = { isBanned: false };
    vi.resetModules();
});

describe("what a member may do is one question", () => {
    it("lets an ordinary member in and lets them write", async () => {
        expect(await standing()).toMatchObject({ mayEnter: true, mayWrite: true });
    });

    it("refuses a member core itself has banned", async () => {
        userRow.value = { isBanned: true };

        expect(await standing()).toMatchObject({ mayEnter: false, mayWrite: false });
    });

    it("lets a module take writing away", async () => {
        filterResult.value = { mayEnter: true, mayWrite: false, until: null, reasonKey: "punishments.silenced" };

        const answer = await standing();

        expect(answer.mayWrite).toBe(false);
        expect(answer.mayEnter).toBe(true);
        expect(answer.reasonKey).toBe("punishments.silenced");
    });

    it("never lets a module hand back what core took away", async () => {
        // A record that could grant a sign-in would be a way to unban somebody
        // by writing a row into a module's table.
        userRow.value = { isBanned: true };
        filterResult.value = { mayEnter: true, mayWrite: true, until: null, reasonKey: null };

        expect(await standing()).toMatchObject({ mayEnter: false, mayWrite: false });
    });

    it("refuses somebody who is not a member at all", async () => {
        userRow.value = null;

        expect(await standing()).toMatchObject({ mayEnter: false, mayWrite: false });
    });

    it("says nothing about a signed-out reader rather than asking the database", async () => {
        expect(await standing("")).toMatchObject({ mayEnter: false, mayWrite: false });
    });

    it("carries a message key and never a machine name, because a member reads it", async () => {
        filterResult.value = { mayEnter: true, mayWrite: false, until: null, reasonKey: "punishments.silenced" };

        const answer = await standing();

        // A key is resolved by the screen. An identifier - "mute", "tempMute" -
        // would reach the member as it stands.
        expect(answer.reasonKey).not.toMatch(/^(ban|mute|tempBan|tempMute|kick|warning)$/);
    });
});
