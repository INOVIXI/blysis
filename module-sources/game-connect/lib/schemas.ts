/** The pieces every game server request is built from. */
import { z } from "zod";

export const instanceField = z.string().min(8).max(64);
export const playerField = z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(64) });
export const keyField = z.string().min(8).max(80);
/** Credits: positive, two decimals at most, and not more than a ledger column holds. */
export const amountField = z
    .number()
    .positive()
    .max(99_999_999)
    .refine((n) => Math.round(n * 100) === n * 100, "At most two decimals");

export const playerRequest = z.object({ instance: instanceField, player: playerField });
