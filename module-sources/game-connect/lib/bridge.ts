/**
 * What this module asks the store and the wallet, and what it means when
 * nobody answers.
 *
 * This module depends on neither, so the shapes are spelled out here rather
 * than taken from their declarations, which exist only where they are
 * installed. Where they are, the compiler checks these against them. An
 * unanswered question comes back as the value passed in, and every value
 * passed in here reads as "not available on this site".
 */
import type { PrismaTransaction } from "@/core/sdk/server";
import { applyFiltersAsync } from "@/core/sdk";

export interface CatalogField {
    name: string;
    label: string;
    type: "text" | "number" | "select";
    required: boolean;
    placeholder: string | null;
    options: string[];
}

export interface CatalogProduct {
    id: string;
    title: string;
    description: string;
    icon: string | null;
    price: number;
    giftable: boolean;
    maxQuantity: number;
    stock: number | null;
    servers: string[];
    fields: CatalogField[];
}

export interface CatalogCategory {
    id: string;
    parentId: string | null;
    title: string;
    description: string;
    icon: string | null;
    order: number;
    products: CatalogProduct[];
}

export interface Catalog {
    currency: "credits";
    categories: CatalogCategory[];
}

export type PurchaseCode =
    | "not_found"
    | "not_in_game"
    | "insufficient_balance"
    | "out_of_stock"
    | "quantity_invalid"
    | "limit_reached"
    | "field_invalid"
    | "not_giftable"
    | "recipient_refuses_gifts"
    | "unavailable";

export type PurchaseResult =
    | { ok: true; orderId: string; orderNumber: string; total: number; balance: number; gift: boolean }
    | { ok: false; code: PurchaseCode; field?: string; reason?: string };

export interface ChestEntryShape {
    id: string;
    productId: string;
    title: string;
    icon: string | null;
    quantity: number;
    state: "ready" | "pending_gift";
    from: string | null;
    createdAt: string;
}

export interface SentGiftShape {
    id: string;
    title: string;
    icon: string | null;
    quantity: number;
    to: string;
    state: "pending_gift" | "accepted";
    createdAt: string;
}

export type ChestAction =
    | { ok: true }
    | { ok: false; code: "not_found" | "already_claimed" | "not_pending" | "needs_player_name" | "unavailable" };

export type GiftCancel = { ok: true; refunded: number; balance: number } | { ok: false; code: "not_found" | "not_pending" | "unavailable" };

export interface CommunityGoal {
    target: number;
    current: number;
    title: string;
    endDate: string | null;
}

export interface TopEntry {
    rank: number;
    userId: string;
    name: string;
    amount: number;
}

const UNAVAILABLE = { ok: false as const, code: "unavailable" as const };

export async function readCatalog(): Promise<Catalog> {
    const empty: Catalog = { currency: "credits", categories: [] };
    return (await applyFiltersAsync("store.catalog.ingame", empty, {})) ?? empty;
}

export async function purchase(request: {
    buyerId: string;
    productId: string;
    quantity: number;
    fields: Record<string, string>;
    recipientId: string | null;
    playerName: string;
    playerId: string | null;
    channel: string;
}): Promise<PurchaseResult> {
    return applyFiltersAsync("store.purchase.credits", UNAVAILABLE as PurchaseResult, request);
}

/** An empty chest that takes no gifts when no store answers. */
export async function chestOf(userId: string): Promise<{ items: ChestEntryShape[]; receiveGifts: boolean }> {
    const empty: { items: ChestEntryShape[]; receiveGifts: boolean } = { items: [], receiveGifts: false };
    return (await applyFiltersAsync("store.chest.list", empty, { userId })) ?? empty;
}

export async function claimChest(userId: string, itemId: string, player: { name: string; id: string }): Promise<ChestAction> {
    return applyFiltersAsync("store.chest.claim", UNAVAILABLE as ChestAction, {
        userId,
        itemId,
        playerName: player.name,
        playerId: player.id,
    });
}

export async function activateGift(userId: string, itemId: string): Promise<ChestAction> {
    return applyFiltersAsync("store.gift.activate", UNAVAILABLE as ChestAction, { userId, itemId });
}

export async function cancelGift(userId: string, itemId: string): Promise<GiftCancel> {
    return applyFiltersAsync("store.gift.cancel", UNAVAILABLE as GiftCancel, { userId, itemId });
}

export async function sentGifts(userId: string): Promise<SentGiftShape[]> {
    return (await applyFiltersAsync("store.gifts.sent", [] as SentGiftShape[], { userId })) ?? [];
}

/** False when no store answers: nothing can be given without one. */
export async function receiveGifts(userId: string, receive: boolean | null): Promise<boolean> {
    return (await applyFiltersAsync("store.gifts.receive", false as boolean, { userId, receive })) === true;
}

export async function communityGoal(): Promise<CommunityGoal | null> {
    return applyFiltersAsync("store.community-goal", null as CommunityGoal | null, {});
}

/** Null when no wallet answers. */
export async function balance(userId: string): Promise<number | null> {
    return applyFiltersAsync("credits.balance", null as number | null, { userId });
}

export async function top(kind: "balance" | "topups" | "latest", period: "day" | "month" | "year" | "all", limit: number): Promise<TopEntry[]> {
    return (await applyFiltersAsync("credits.top", [] as TopEntry[], { kind, period, limit })) ?? [];
}

/** Moves credits on the caller's transaction. False when refused or when no wallet answers. */
export async function moveCredits(
    tx: PrismaTransaction,
    movement: { userId: string; amount: number; type: string; description: string },
): Promise<boolean> {
    const moved = await applyFiltersAsync("credit.change", { applied: false }, { tx, ...movement });
    return moved?.applied === true;
}
