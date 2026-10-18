/** The pieces every game server request is built from. */
import { z } from "zod";
import { refuse } from "./auth";

export const instanceField = z.string().min(8).max(64);
export const playerField = z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(64) });
export const keyField = z.string().min(8).max(80);
/**
 * Credits as a client sends them: any number. Whether it is an amount is
 * answered as `409 amount_invalid`, a refusal a game shows its player, and
 * not as a malformed body.
 */
export const amountField = z.number().finite();

/** Positive, two decimals at most, and not more than a ledger column holds. */
export function isAmount(n: number): boolean {
    return n > 0 && n <= 99_999_999 && Math.round(n * 100) === n * 100;
}

export function amountRefused() {
    return refuse(409, "amount_invalid", "Name an amount above zero, with two decimals at most.");
}

export const playerRequest = z.object({ instance: instanceField, player: playerField });
