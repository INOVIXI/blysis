import { z } from "zod";

/**
 * An admin credit grant.
 *
 * The hand-rolled check that this replaces read `!amount || amount <= 0 ||
 * amount > 100000` on an untyped value, so a string amount compared true
 * against a number and reached Prisma's `increment`, and a fractional amount
 * passed every bound it tested. `userId` reached a `where` clause with no
 * type at all, where an object is a filter operator rather than an id.
 */
export const creditPurchaseSchema = z.object({
    userId: z.string().trim().min(1).max(64),
    amount: z.number().int().min(1).max(100_000),
});

/**
 * A change to a member's balance by hand: signed, whole, never zero, with the
 * reason the member will read on the row. The rules beyond the shape are
 * `adjustmentRefusal` in `adjust.ts`.
 */
export const creditAdjustSchema = z.object({
    userId: z.string().trim().min(1).max(64),
    amount: z.number().int(),
    reason: z.string().max(500),
    allowNegative: z.boolean().optional(),
});
