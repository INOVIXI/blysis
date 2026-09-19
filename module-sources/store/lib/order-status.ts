/**
 * What an order's status is called, in the reader's language.
 *
 * `OrderStatus` is a Prisma enum, so the column holds `IN` capitals. Three
 * screens printed that enum straight out: the admin order list, the admin
 * order detail, and the status dropdown that sets it - while five perfectly
 * good admin-scoped orderStatus messages sat in the manifest, in both
 * locales, referenced by nothing.
 *
 * The customer's own order tab was worse than untranslated. It mapped each
 * status to a `tab_orders_status*` key that the manifest never declared, and
 * next-intl renders the key path rather than throwing, so a customer's
 * completed order read "store.tab_orders_statusCompleted". Those five
 * messages now exist, and every lookup here goes through `t.has` so a status
 * added later degrades to the enum rather than to a key path.
 */

/** Every status the store sets, in the order the dropdown offers them. */
export const ORDER_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED", "REFUNDED"] as const;

/**
 * The admin catalogue's keys are built by the admin screens rather than named
 * here: core strips `adm_` keys from the catalogue a public page receives, so
 * a file shared with the customer's order tab must not carry one.
 */
export function adminOrderStatusKeys(prefix: string): Record<string, string> {
    return Object.fromEntries(ORDER_STATUSES.map((status) => [status, `${prefix}${status}`]));
}

/** Customer catalogue keys, one per status. */
export const ORDER_STATUS_KEYS: Record<string, string> = {
    PENDING: "tab_orders_statusPending",
    PROCESSING: "tab_orders_statusProcessing",
    COMPLETED: "tab_orders_statusCompleted",
    CANCELLED: "tab_orders_statusCancelled",
    REFUNDED: "tab_orders_statusRefunded",
};

type Translator = ((key: string) => string) & { has: (key: string) => boolean };

/** Look one up, falling back to the enum itself when the message is absent. */
export function orderStatusLabel(t: Translator, keys: Record<string, string>, status: string): string {
    const key = keys[status];
    return key && t.has(key) ? t(key) : status;
}

/**
 * The colour an order status wears.
 *
 * The orders table and the status control beside a single order each kept a
 * map of their own, and they had already drifted: PROCESSING was primary on
 * one and amber on the other. Both wrote `bg-.../10 text-...` pairs by hand
 * rather than using the badge every other status on the site is drawn with.
 */
import type { BadgeTone } from "@/core/sdk/ui";

const TONES: Record<string, BadgeTone> = {
    PENDING: "warning",
    PROCESSING: "info",
    COMPLETED: "success",
    CANCELLED: "danger",
    REFUNDED: "neutral",
};

/** Neutral for a status no map names: an unknown state is not an alarming one. */
export function orderStatusTone(status: string): BadgeTone {
    return TONES[status] ?? "neutral";
}
