/**
 * What a purchase remembers between being paid for and being claimed.
 *
 * Checkout asks a buyer for the name to deliver to, separately from the name
 * they signed in with, because those are different on every site that
 * delivers into a game. It collects the fields the product asks for at the
 * same time and hands both to delivery.
 *
 * A purchase that waits in the chest is claimed later, and none of that used
 * to be written down. Redeeming ran the product's commands with the account's
 * username - the one name checkout deliberately did not use - and with none
 * of the answers the buyer typed. The commands ran; they ran for the wrong
 * person.
 *
 * The fix is not a better fallback. There is no name in the session worth
 * guessing with, so when nothing was recorded and nothing was typed, this
 * says so and the screen asks.
 */

import { Prisma } from "@prisma/client";
import { snapshotIn, unitsDelivered } from "./variants";

/** A chest row, as far as delivering it is concerned. */
export interface ChestRow {
    productName: string;
    quantity: number;
    /** The name taken at checkout. Null for a row nobody bought. */
    playerName: string | null;
    /**
     * The answers taken at checkout. `unknown` on purpose: it is a JSON
     * column, so the row may predate the shape or have been written by hand,
     * and the narrowing belongs here rather than at every reader.
     */
    variables: unknown;
}

/** What the claimer said now, if anything. */
export interface ClaimRequest {
    playerName?: string | null;
    /**
     * Named so a reader sees it is deliberately unused. It is the tempting
     * fallback and it is the wrong one.
     */
    accountUsername?: string;
}

export type ChestDelivery =
    | { playerName: string; productName: string; quantity: number; variables?: Record<string, string> }
    | { needsPlayerName: true };

/**
 * Only the answers that are text.
 *
 * The column is JSON: the row may predate the shape or have been written by
 * hand, and a number reaching the command builder is a `{size}` replaced with
 * "[object Object]" or nothing at all.
 */
function answersIn(value: unknown): Record<string, string> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const answers: Record<string, string> = {};
    for (const [key, answer] of Object.entries(value)) {
        if (typeof answer === "string") answers[key] = answer;
    }
    return Object.keys(answers).length > 0 ? answers : undefined;
}

/** How to deliver a claimed item, or that there is nobody to deliver it to. */
export function deliveryFor(item: ChestRow, claim: ClaimRequest): ChestDelivery {
    // What they type now wins: somebody buying for one account and claiming
    // onto another is the reason the box is on the screen at all.
    const name = claim.playerName?.trim() || item.playerName?.trim() || "";
    if (name === "") return { needsPlayerName: true };

    return {
        playerName: name,
        productName: item.productName,
        quantity: item.quantity,
        variables: answersIn(item.variables),
    };
}

/**
 * The name recorded on a chest row, or null.
 *
 * Read off the order rather than passed in, because settlement is also
 * reached by a gateway's webhook minutes later, where nobody is holding a
 * form any more. Anything that is not a name is no name: the column is JSON
 * and an order may have been written by something other than checkout.
 */
export function recordedPlayerName(orderMetadata: unknown): string | null {
    if (typeof orderMetadata !== "object" || orderMetadata === null) return null;
    const name = (orderMetadata as Record<string, unknown>).playerName;
    if (typeof name !== "string") return null;
    return name.trim() === "" ? null : name;
}

/** The answers recorded on one line, or null when it asked for none. */
export function recordedVariables(lineMetadata: unknown): Record<string, string> | null {
    if (typeof lineMetadata !== "object" || lineMetadata === null) return null;
    return answersIn((lineMetadata as Record<string, unknown>).variables) ?? null;
}

/**
 * The chest row's quantity and variant for an order line.
 *
 * A line bought as a variant becomes a row of the units it delivers, so a
 * claim, which reads only the row, hands out six keys for a pack of six. The
 * variant goes with it for its own commands. A line without one is the row it
 * always was.
 */
export function chestFieldsFor(line: { quantity: number; metadata: unknown }): {
    quantity: number;
    variant: Prisma.InputJsonValue | typeof Prisma.JsonNull;
} {
    const variant = snapshotIn(line.metadata);
    return {
        quantity: unitsDelivered(line.quantity, variant),
        variant: variant ? (variant as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    };
}
