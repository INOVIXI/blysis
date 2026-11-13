/**
 * Whether a paid purchase runs its commands at payment or waits in the chest.
 *
 * A shop decides for every product at once (`holdPurchasesInChest`), and a
 * product may decide for itself. The product's own answer wins; `inherit`, or
 * a value written by something other than the product form, is the shop's.
 */
export const DELIVERY_MODES = ["inherit", "now", "hold"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export function isDeliveryMode(value: unknown): value is DeliveryMode {
    return typeof value === "string" && (DELIVERY_MODES as readonly string[]).includes(value);
}

export function waitsInChest(productMode: string | null | undefined, shopHolds: boolean): boolean {
    if (productMode === "hold") return true;
    if (productMode === "now") return false;
    return shopHolds;
}
