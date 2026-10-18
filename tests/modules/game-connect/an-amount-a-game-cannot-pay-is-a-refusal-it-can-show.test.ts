// @vitest-environment node
/**
 * A player types an amount in game. When it is no amount at all, the game must
 * be able to tell them, so the site answers with a refusal the game knows
 * (`409 amount_invalid`) and not with a malformed-body error it can only log.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/core/sdk/server", () => ({ prisma: {} }));

const { amountField, amountRefused, isAmount } = await import("@/modules/game-connect/lib/schemas");

describe("an amount of credits", () => {
    it("is above zero, with two decimals at most, and fits the ledger", () => {
        expect(isAmount(1)).toBe(true);
        expect(isAmount(0.01)).toBe(true);
        expect(isAmount(99_999_999)).toBe(true);

        expect(isAmount(0)).toBe(false);
        expect(isAmount(-5)).toBe(false);
        expect(isAmount(0.001)).toBe(false);
        expect(isAmount(100_000_000)).toBe(false);
    });

    it("that is no amount still reads as a body, so the refusal can be the one a game shows", async () => {
        expect(amountField.safeParse(0.001).success).toBe(true);
        expect(amountField.safeParse("ten").success).toBe(false);

        const refusal = amountRefused();
        expect(refusal.status).toBe(409);
        await expect(refusal.json()).resolves.toMatchObject({ code: "amount_invalid" });
    });
});
