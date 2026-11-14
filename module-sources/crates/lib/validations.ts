import { z } from "zod";
import { CRATE_PERIODS, RARITIES, REWARD_KINDS } from "./crates";

/**
 * A crate an operator set up. `slug` is the address it answers on, so it is
 * held to what a URL segment may hold rather than to whatever was typed.
 *
 * Numbers are coerced so a client sending "10" still works, but the result has
 * to be a whole number in range: a fractional price reached an `Int` column as
 * a 500 on the wheel before its schema said otherwise.
 */
export const crateSchema = z.object({
    name: z.string().trim().min(1).max(80),
    slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, "Letters, numbers and hyphens"),
    description: z.string().trim().max(300).optional().nullable(),
    image: z.string().trim().max(500).optional().nullable(),
    cost: z.coerce.number().int().min(0).max(1_000_000).optional(),
    keyProductId: z.string().trim().max(64).optional().nullable(),
    perPersonLimit: z.coerce.number().int().min(0).max(10_000).optional(),
    perPersonPeriod: z.enum(CRATE_PERIODS).optional(),
    /** What the admin form writes: one role, or "" for everyone. */
    roleId: z.string().max(64).optional().nullable(),
    isActive: z.boolean().optional(),
    order: z.coerce.number().int().min(0).max(10_000).optional(),
});

export const rewardSchema = z.object({
    crateId: z.string().trim().min(1, "Pick a crate").max(64),
    name: z.string().trim().min(1).max(100),
    kind: z.enum(REWARD_KINDS),
    /** What a reward of kind `product` hands over, as the store named it. */
    productId: z.string().trim().max(64).optional().nullable(),
    value: z.coerce.number().int().min(0).max(1_000_000).optional(),
    weight: z.coerce.number().int().min(0).max(1_000_000).optional(),
    rarity: z.enum(RARITIES).optional(),
    order: z.coerce.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
});

/** Which payment the member asked for. Absent spends a key first, then credits. */
export const openSchema = z.object({
    pay: z.enum(["key", "credits"]).optional(),
});
