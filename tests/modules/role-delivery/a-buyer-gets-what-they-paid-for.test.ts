// @vitest-environment node
import { describe, it, expect } from "vitest";
import { planGrant } from "@/modules/role-delivery/lib/grant-plan";

/**
 * What a listing may sell, and what it must refuse before any credits move.
 *
 * This decision used to carry the whole weight of a member holding exactly one
 * role: a sold rank replaced what the buyer was, and putting it back thirty
 * days later meant having remembered it, so the plan had to say which of two
 * writes it was and what to restore. A member holds a set now. A rank is added
 * to it, the lapse takes back only itself, and core decides whether the grant
 * writes a row or pushes a date out.
 *
 * What is left here are the refusals, and they matter because the moment
 * before the credits move is the only moment a refusal is free.
 */

const NOW = new Date("2026-09-10T12:00:00Z");
const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

const world = { existingRoleIds: new Set(["gold", "silver", "member"]) };
const wanted = { roleId: "gold", days: 30 };

describe("a rank that can be handed over", () => {
    it("is granted until the day the listing sold", () => {
        expect(planGrant(wanted, null, world, NOW)).toEqual({
            grant: { roleId: "gold", expiresAt: inDays(30) },
        });
    });

    it("is added to whatever else the buyer holds", () => {
        // Nothing in the plan names another role, which is the point: the
        // buyer's other roles are not this decision's business, and the shape
        // that made them its business is what let a bought rank take a
        // moderator's job away.
        const plan = planGrant(wanted, null, world, NOW);
        expect(JSON.stringify(plan)).not.toContain("previous");
    });
});

describe("what is refused, before any credits move", () => {
    it("refuses a role that is not there any more", () => {
        expect(planGrant({ roleId: "bronze", days: 30 }, null, world, NOW)).toEqual({
            refuse: "unknown_role",
        });
    });

    it("refuses a role named as nothing at all", () => {
        expect(planGrant({ roleId: "  ", days: 30 }, null, world, NOW)).toEqual({
            refuse: "unknown_role",
        });
    });

    it("refuses a length of time that is not one", () => {
        for (const days of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 3651]) {
            expect(planGrant({ roleId: "gold", days }, null, world, NOW)).toEqual({
                refuse: "bad_duration",
            });
        }
    });

    it("refuses a buyer who already holds it for good", () => {
        // An operator gave it to them permanently. Selling thirty days of it
        // would either do nothing or put an end date on a promotion somebody
        // meant to last.
        expect(planGrant(wanted, { expiresAt: null }, world, NOW)).toEqual({
            refuse: "already_held",
        });
    });
});

describe("buying more of a rank already held", () => {
    it("adds to what is left rather than starting again", () => {
        // Twenty-five days left plus thirty bought is fifty-five. Starting
        // again is taking money for days it then deletes.
        expect(planGrant(wanted, { expiresAt: inDays(25) }, world, NOW)).toEqual({
            grant: { roleId: "gold", expiresAt: inDays(55) },
        });
    });

    it("starts from now when the old grant has already lapsed", () => {
        expect(planGrant(wanted, { expiresAt: inDays(-3) }, world, NOW)).toEqual({
            grant: { roleId: "gold", expiresAt: inDays(30) },
        });
    });

    it("takes the whole day count, never a part of one", () => {
        expect(planGrant({ roleId: "gold", days: 30 }, { expiresAt: inDays(1) }, world, NOW)).toEqual({
            grant: { roleId: "gold", expiresAt: inDays(31) },
        });
    });
});
