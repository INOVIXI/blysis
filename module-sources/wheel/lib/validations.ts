import { z } from "zod";
import { WHEEL_COOLDOWNS } from "./wheels";

/**
 * A prize on the wheel.
 *
 * `probability` decides how often it is drawn and `value` decides what it
 * pays out, and both reached `Int` columns untyped: a fractional probability
 * or a string value was a 500. The PATCH coerced with `Number(...) || fallback`
 * instead, which silently turned a typo into the default rather than an error;
 * the coercion is kept so a client sending "10" still works, but the result
 * now has to be a whole number in range.
 */
export const wheelPrizeCreateSchema = z.object({
    wheelId: z.string().max(64).optional().nullable(),
    name: z.string().trim().min(1, "Name and type required").max(100),
    type: z.string().trim().min(1, "Name and type required").max(32),
    /**
     * What a prize of kind `product` hands over, as whoever owns the thing
     * named it. Opaque: this module has no vocabulary for what it is, which
     * is the whole point of asking rather than reading.
     */
    productId: z.string().trim().max(64).optional().nullable(),
    value: z.coerce.number().int().min(0).max(1_000_000).optional(),
    color: z.string().max(32).optional(),
    probability: z.coerce.number().int().min(0).max(1_000_000).optional(),
    order: z.coerce.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
});

export const wheelPrizeUpdateSchema = wheelPrizeCreateSchema.partial();

/**
 * A wheel an operator set up. `slug` is the address it answers on, so it is
 * held to what a URL segment may hold rather than to whatever was typed.
 */
export const wheelSchema = z.object({
    name: z.string().trim().min(1).max(80),
    slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, "Letters, numbers and hyphens"),
    description: z.string().trim().max(300).optional().nullable(),
    cooldown: z.enum(WHEEL_COOLDOWNS),
    cooldownHours: z.number().int().min(0).max(24 * 365).optional(),
    cost: z.number().int().min(0).max(1_000_000).optional(),
    roleIds: z.array(z.string().max(64)).max(20).optional(),
    /** What the admin form writes: one role, or "" for everyone. */
    roleId: z.string().max(64).optional().nullable(),
    isActive: z.boolean().optional(),
    order: z.number().int().min(0).max(10_000).optional(),
});
