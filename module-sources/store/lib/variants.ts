/**
 * The ways one product is sold: a pack of three keys, a rank for six months.
 *
 * A shop that wanted to sell a key one, three or six at a time made three
 * products, and the shelf held every size of every key side by side. Each
 * copy carried the same image, the same text and the same commands, and a
 * fixed command edited on one of them stayed wrong on the others. A variant
 * is one row of a product's own list instead: its name, its price, and what
 * it changes about the delivery.
 *
 * Kept as JSON on the product rather than as a table, because a variant is
 * never read without its product and never outlives it. The line a buyer
 * pays for keeps its own copy (`snapshotOf`), so a variant renamed, repriced
 * or deleted later does not rewrite an order that was already paid.
 *
 * Nothing here is about a product without variants: such a product has none
 * of these, and every function hands its values back untouched.
 */
import { originalText, textFor, isTranslatableText, type TranslatableText } from "@/core/sdk";

/** The most variants one product may carry; a list longer than this is not a picker. */
export const MAX_VARIANTS = 24;

export interface ProductVariant {
    /** Stable across edits, so a basket and an order keep pointing at the same one. */
    id: string;
    label: TranslatableText;
    /** The price of one of these, the whole pack, before any offer. */
    price: number;
    /**
     * How many units one of these delivers. Three for a pack of three keys:
     * the commands see three in `{quantity}`, or run three times when the
     * product runs its commands once per unit.
     */
    units: number;
    /** How long it lasts, in place of the product's own duration. Null keeps the product's. */
    durationDays: number | null;
    /**
     * Values the operator set for the commands, read like the buyer's answers
     * as `{name}`. They win over an answer of the same name: the operator
     * wrote them, the buyer did not.
     */
    variables: Record<string, string>;
    /** Commands run in place of the product's. Empty runs the product's own. */
    commands: VariantCommand[];
    isActive: boolean;
}

export interface VariantCommand {
    command: string;
    serverId: string | null;
    target: string | null;
    whenOnline: boolean | null;
}

/**
 * What an order line or a chest row keeps of the variant it was bought as.
 *
 * The label is kept in the language it was bought in and as typed, so an
 * order screen can still name it after the variant is gone.
 */
export interface VariantSnapshot {
    id: string;
    label: string;
    units: number;
    durationDays: number | null;
    commands: VariantCommand[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wholeAtLeastOne(value: unknown): number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 1;
}

function stringsOf(value: unknown): Record<string, string> {
    if (!isRecord(value)) return {};
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === "string" && key.trim() !== "") out[key] = entry;
    }
    return out;
}

function commandsOf(value: unknown): VariantCommand[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.command === "string")
        .filter((entry) => (entry.command as string).trim() !== "")
        .map((entry) => ({
            command: entry.command as string,
            serverId: typeof entry.serverId === "string" ? entry.serverId : null,
            target: typeof entry.target === "string" ? entry.target : null,
            whenOnline: typeof entry.whenOnline === "boolean" ? entry.whenOnline : null,
        }));
}

/**
 * The variants a product carries, every one of them.
 *
 * The column is JSON, so it may hold anything: an entry without an id, a
 * label or a price is not a variant anybody could pay for and is left out,
 * rather than reaching a checkout as a price of NaN.
 */
export function variantsOf(raw: unknown): ProductVariant[] {
    if (!Array.isArray(raw)) return [];
    const out: ProductVariant[] = [];
    for (const entry of raw) {
        if (!isRecord(entry)) continue;
        if (typeof entry.id !== "string" || entry.id === "") continue;
        if (!isTranslatableText(entry.label) || originalText(entry.label).trim() === "") continue;
        const price = Number(entry.price);
        if (!Number.isFinite(price) || price < 0) continue;
        const days = entry.durationDays;
        out.push({
            id: entry.id,
            label: entry.label,
            price: Math.round(price * 100) / 100,
            units: wholeAtLeastOne(entry.units),
            durationDays: typeof days === "number" && Number.isInteger(days) && days > 0 ? days : null,
            variables: stringsOf(entry.variables),
            commands: commandsOf(entry.commands),
            isActive: entry.isActive !== false,
        });
    }
    return out;
}

/** The variants a buyer may choose from, in the order the operator put them. */
export function offeredVariants(raw: unknown): ProductVariant[] {
    return variantsOf(raw).filter((variant) => variant.isActive);
}

/**
 * The variant a basket line names, or why it names none a buyer may have.
 *
 * A product that offers variants is never sold without one: its own price is
 * then only the starting point the shelf shows. A product with none is sold
 * as it always was, and a variant named for it is refused rather than
 * ignored, because a buyer who picked something should not be charged for
 * something else.
 */
export function chosenVariant(
    raw: unknown,
    variantId: string | null | undefined,
): { ok: true; variant: ProductVariant | null } | { ok: false; code: "store_variant_required" | "store_variant_unavailable" } {
    const offered = offeredVariants(raw);
    if (offered.length === 0) {
        return variantId ? { ok: false, code: "store_variant_unavailable" } : { ok: true, variant: null };
    }
    if (!variantId) return { ok: false, code: "store_variant_required" };
    const variant = offered.find((entry) => entry.id === variantId);
    return variant ? { ok: true, variant } : { ok: false, code: "store_variant_unavailable" };
}

/**
 * A variant's price after whatever offer the product is under.
 *
 * Every offer the shop has, a sale price, a campaign, a store-wide sale, is
 * worked out on the product's own price. A variant takes the same share off:
 * a product at 100 offered at 80 sells its 270 pack at 216. Applying the
 * offer's absolute price to a pack would sell six keys for the price of one.
 */
export function offeredVariantPrice(variantPrice: number, listPrice: number, offeredPrice: number): number {
    if (!(listPrice > 0) || !(offeredPrice < listPrice)) return variantPrice;
    const share = Math.max(0, offeredPrice) / listPrice;
    return Math.round(variantPrice * share * 100) / 100;
}

/**
 * What one of a basket line costs, before any credit or bulk rung: its
 * variant's price under the product's offer, or the product's offered price
 * for a line with no variant. The cart, the coupon preview and the creator
 * code preview all ask this, so none of them quotes the product's price for
 * a pack of six.
 */
export function basketLinePrice(
    product: { price: unknown; variants?: unknown },
    variantId: string | null | undefined,
    offeredPrice: number,
): number {
    const variant = variantId ? offeredVariants(product.variants).find((entry) => entry.id === variantId) : undefined;
    return variant ? offeredVariantPrice(variant.price, Number(product.price), offeredPrice) : offeredPrice;
}

/**
 * What each variant saves against buying the cheapest one many times, in
 * whole percent; zero where it saves nothing.
 *
 * The yardstick is the variant with the dearest price per unit (per day for
 * a timed one), which is the one somebody buying "just one" pays. Worked out
 * here, not typed by the operator, so the badge can never claim a saving the
 * prices do not give.
 */
export function variantSavings(variants: readonly ProductVariant[], productDurationDays: number | null): Map<string, number> {
    const per = (variant: ProductVariant): number | null => {
        const days = variant.durationDays ?? productDurationDays;
        const amount = days && days > 0 ? days : variant.units;
        return amount > 0 ? variant.price / amount : null;
    };
    const rates = variants.map((variant) => per(variant)).filter((rate): rate is number => rate !== null && rate > 0);
    const out = new Map<string, number>();
    if (rates.length === 0) return out;
    const dearest = Math.max(...rates);
    for (const variant of variants) {
        const rate = per(variant);
        if (rate === null) continue;
        // Down, so a badge never promises more than the prices give, and past
        // the float error that turns 1 - 0.9 into 9.999 per cent.
        const saving = Math.floor((1 - rate / dearest) * 100 + 1e-9);
        out.set(variant.id, saving > 0 ? saving : 0);
    }
    return out;
}

/** The line's name: the product's, then the variant's in the buyer's language. */
export function variantLineName(productName: string, variant: ProductVariant | null, locale: string): string {
    if (!variant) return productName;
    const label = textFor(variant.label, locale).trim();
    return label ? `${productName} - ${label}` : productName;
}

/** What a line keeps of the variant it was bought as. */
export function snapshotOf(variant: ProductVariant, locale: string): VariantSnapshot {
    return {
        id: variant.id,
        label: textFor(variant.label, locale),
        units: variant.units,
        durationDays: variant.durationDays,
        commands: variant.commands,
    };
}

/**
 * The variant a line or a chest row was bought as, from its JSON.
 *
 * Read from what the line kept, never from the product now: an operator who
 * changes a pack of three to a pack of four has not sold anybody a fourth key.
 */
export function snapshotIn(value: unknown): VariantSnapshot | null {
    const raw = isRecord(value) && isRecord(value.variant) ? value.variant : isRecord(value) && "units" in value ? value : null;
    if (!raw || typeof raw.id !== "string") return null;
    const days = raw.durationDays;
    return {
        id: raw.id,
        label: typeof raw.label === "string" ? raw.label : "",
        units: wholeAtLeastOne(raw.units),
        durationDays: typeof days === "number" && Number.isInteger(days) && days > 0 ? days : null,
        commands: commandsOf(raw.commands),
    };
}

/**
 * A kept variant as its buyer may read it: everything but the commands it
 * runs, which are the shop's as much on an order as on the product page.
 * Anything that is not a kept variant is handed back as it came.
 */
export function buyersVariant(value: unknown): unknown {
    if (!isRecord(value) || !("commands" in value)) return value;
    const { commands: _commands, ...rest } = value;
    return rest;
}

/** An order line's metadata as its buyer may read it; see `buyersVariant`. */
export function buyersLineMetadata(metadata: unknown): unknown {
    if (!isRecord(metadata) || !isRecord(metadata.variant)) return metadata;
    return { ...metadata, variant: buyersVariant(metadata.variant) };
}

/** How many units a line of this many delivers. */
export function unitsDelivered(quantity: number, variant: { units: number } | null): number {
    return quantity * (variant?.units ?? 1);
}

/**
 * The answers a line delivers with: the buyer's, then the variant's values
 * over them. The operator's value wins a name both use, because a buyer must
 * not be able to type the amount a command hands out.
 */
export function variablesWithVariant(
    answers: Record<string, string> | null | undefined,
    variant: ProductVariant | null,
): Record<string, string> {
    return { ...(answers ?? {}), ...(variant?.variables ?? {}) };
}

/** A variant as a shopper's page draws it: no commands, no operator values. */
export interface PublicVariant {
    id: string;
    label: string;
    /** What this reader pays for one, any offer and upgrade credit taken off. */
    price: number;
    /** The same before the offer, struck through when an offer runs. */
    fullPrice: number;
    units: number;
    durationDays: number | null;
    /** Whole percent saved against the dearest per unit; zero for none. */
    saving: number;
}

/**
 * The variants a product page offers, priced for this reader.
 *
 * Built field by field because the column also holds the commands and the
 * values the operator set for them, which are the shop's and never the
 * page's.
 */
export function publicVariants(
    raw: unknown,
    locale: string,
    prices: { listPrice: number; offeredPrice: number; credit: number; durationDays: number | null },
): PublicVariant[] {
    const offered = offeredVariants(raw);
    const savings = variantSavings(offered, prices.durationDays);
    return offered.map((variant) => {
        const after = offeredVariantPrice(variant.price, prices.listPrice, prices.offeredPrice);
        return {
            id: variant.id,
            label: textFor(variant.label, locale),
            price: Math.max(0, Math.round((after - prices.credit) * 100) / 100),
            fullPrice: variant.price,
            units: variant.units,
            durationDays: variant.durationDays ?? prices.durationDays,
            saving: savings.get(variant.id) ?? 0,
        };
    });
}
