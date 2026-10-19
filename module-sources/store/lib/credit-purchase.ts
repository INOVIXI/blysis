/**
 * A purchase paid in credits from somewhere other than the checkout page:
 * a game server selling on the site's behalf.
 *
 * It asks the questions checkout asks, with the same functions, so a price
 * shown in game is the price the site would take: whether the product is for
 * sale to this member right now, the per-person and per-period limits, the
 * fields it needs, a sale price, a bulk discount, an upgrade credit, tax. It
 * leaves out what a game has no screen for: coupons, creator codes, and an
 * invoice address, which is why a site that has to invoice refuses here and
 * says so rather than issuing an invoice to nobody.
 */
import { Prisma } from "@prisma/client";
import { applyFiltersAsync, doActionAsync } from "@/core/sdk";
import { log, logActivity, moduleSettings, prisma, siteTimeZone, type PrismaTransaction } from "@/core/sdk/server";
import { availabilityFor, rulesOf, type ProductRow } from "./availability-server";
import { effectivePrice } from "./availability";
import { computeOrderPricing, computeTotals } from "./pricing";
import { creditingPurchases, ownedRungsOn } from "./upgrade-credit-server";
import { resolveCurrency } from "./currency";
import { createCreditOrder, deliverPaidOrder, INSUFFICIENT_CREDITS, OUT_OF_STOCK } from "./credit-order";
import { announceOrderCompleted, announceOrderCreated } from "./order-events";
import { receivesGifts, siteAllowsGifting } from "./gifts";

/** Thrown inside the transaction when the limit filled while this purchase waited for it. */
export const LIMIT_REACHED = "LIMIT_REACHED";

/** One purchase in a game buys at most this many of one product. */
export const MAX_GAME_QUANTITY = 64;
const MAX_FIELD_LENGTH = 100;

type Refusal = Extract<CreditPurchaseResult, { ok: false }>;

function refuse(code: Refusal["code"], extra: Partial<Refusal> = {}): Refusal {
    return { ok: false, code, ...extra };
}

interface FieldRow {
    name: string;
    label: string;
    type: string;
    required: boolean;
    options: string | null;
}

/** The options of a select field, however the admin wrote them. */
export function optionsOf(raw: string | null): string[] {
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean);
    } catch {
        // Not JSON: a comma-separated list, the other way the editor stores it.
    }
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** The first field the answers do not satisfy, or null. */
export function invalidField(fields: FieldRow[], answers: Record<string, string>): string | null {
    for (const field of fields) {
        const value = (answers[field.name] ?? "").trim();
        if (value === "") {
            if (field.required) return field.name;
            continue;
        }
        if (value.length > MAX_FIELD_LENGTH) return field.name;
        if (field.type === "number" && !/^-?\d+(\.\d+)?$/.test(value)) return field.name;
        if (field.type === "select") {
            const options = optionsOf(field.options);
            if (options.length > 0 && !options.includes(value)) return field.name;
        }
    }
    return null;
}

/**
 * Counts the member's allowance again, alone, inside the purchase's transaction.
 *
 * The count before the transaction is a snapshot: ten purchases sent together
 * all read "none bought yet", and four of ten got through a limit of one. A
 * transaction lock on the member and the product makes the next purchase wait
 * until this one commits, and its count then sees this order.
 */
async function holdTheLimit(tx: PrismaTransaction, product: ProductRow, ownerId: string, quantity: number, now: Date, zone: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store-limit:${ownerId}:${product.id}`}))`;
    const again = await availabilityFor(tx, product, ownerId, now, zone);
    if (again.state === "limit_reached" || (again.remainingForPerson !== null && quantity > again.remainingForPerson)) {
        throw new Error(LIMIT_REACHED);
    }
}

interface PricedProduct {
    id: string;
    name: string;
    type: string;
    categoryId: string | null;
}

/**
 * What this member pays for this many, with every rule checkout applies that a
 * game can meet: the sale window, an upgrade credit for a lower rung they own,
 * a bulk discount for the quantity, tax. One function, so the price a game
 * quotes and the price a purchase takes cannot drift apart.
 */
async function priceInGame(product: PricedProduct, quantity: number, ownerId: string, answers: Record<string, string>, now: Date) {
    const ownedIds = await creditingPurchases(ownerId);
    const { subtotal, orderItems } = computeOrderPricing({
        items: [{ productId: product.id, quantity }],
        products: [
            {
                id: product.id,
                name: product.name,
                type: product.type,
                price: effectivePrice(rulesOf(product as unknown as ProductRow), now).price,
                categoryId: product.categoryId,
            },
        ],
        bulkDiscounts: await prisma.bulkDiscount.findMany({ where: { isActive: true }, take: 500 }),
        ownedProductIds: ownedIds,
        ownedRungs: await ownedRungsOn([product.categoryId], ownedIds, now),
        variables: { [product.id]: answers },
    });

    const { taxRate, taxIncluded } = await moduleSettings<{ taxRate: number; taxIncluded: boolean }>("store");
    const { totalDiscount, tax, total } = computeTotals({ subtotal, couponDiscount: 0, creatorDiscount: 0, taxRate, taxIncluded });
    return { subtotal, orderItems, totalDiscount, tax, total };
}

type NotSellable = { ok: false; code: "not_found" | "not_in_game" | "quantity_invalid" };

const notSellable = (code: NotSellable["code"]): NotSellable => ({ ok: false, code });

/** A product a game may sell, or why not: the first checks a purchase makes, before any money. */
async function sellableInGame(productId: string, quantity: number) {
    const product = await prisma.product.findFirst({
        where: { id: productId, isActive: true },
        include: { category: { select: { id: true, showInGame: true } } },
    });
    if (!product) return notSellable("not_found");
    if (!product.showInGame || !product.category?.showInGame) return notSellable("not_in_game");
    // A subscription renews through a gateway; credits cannot carry one.
    if (product.type === "SUBSCRIPTION") return notSellable("not_in_game");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_GAME_QUANTITY) return notSellable("quantity_invalid");
    return product;
}

/**
 * Who would own the purchase, or why it cannot be a gift to them. A quote and a
 * purchase ask the same: a quote for a gift prices it on the recipient's own
 * purchases, so a quote the purchase would refuse would tell the asker what a
 * member who takes no gifts owns.
 */
type Owner = { ok: true; gift: boolean; ownerId: string } | { ok: false; code: "not_giftable" | "recipient_refuses_gifts" };

async function ownerFor(product: { giftable: boolean }, buyerId: string, recipientId: string | null): Promise<Owner> {
    if (recipientId === null || recipientId === buyerId) return { ok: true, gift: false, ownerId: buyerId };
    if (!product.giftable || !(await siteAllowsGifting())) return { ok: false, code: "not_giftable" };
    if (!(await receivesGifts(recipientId))) return { ok: false, code: "recipient_refuses_gifts" };
    return { ok: true, gift: true, ownerId: recipientId };
}

/**
 * What a purchase in game would take, before the player confirms it.
 *
 * The catalogue a game draws is the same for every player, so it carries the
 * product's price and nothing a member's own purchases or the quantity take
 * off it. Measured live: the confirm button said 5 and the purchase took 4
 * from a member who owned a cheaper product on the same shelf. A game asks
 * this for the basket on its screen and shows the answer.
 */
export async function quoteWithCredits(request: CreditQuoteRequest): Promise<CreditQuoteResult> {
    const product = await sellableInGame(request.productId, request.quantity);
    if ("ok" in product) return product;
    const owner = await ownerFor(product, request.buyerId, request.recipientId);
    if (!owner.ok) return owner;
    const { orderItems, total } = await priceInGame(product, request.quantity, owner.ownerId, {}, new Date());
    return { ok: true, each: orderItems[0]?.price ?? 0, total };
}

export async function purchaseWithCredits(request: CreditPurchaseRequest): Promise<CreditPurchaseResult> {
    const now = new Date();
    const product = await sellableInGame(request.productId, request.quantity);
    if ("ok" in product) return product;
    const quantity = request.quantity;

    const owner = await ownerFor(product, request.buyerId, request.recipientId);
    if (!owner.ok) return refuse(owner.code);
    const { gift, ownerId } = owner;

    // For sale, to the member who will own it, right now.
    const zone = await siteTimeZone();
    const state = await availabilityFor(prisma, product as unknown as ProductRow, ownerId, now, zone);
    if (!state.buyable) {
        if (state.state === "sold_out" || state.state === "sold_out_for_now") return refuse("out_of_stock");
        if (state.state === "limit_reached") return refuse("limit_reached");
        // Closed to this member now, for a reason a game can name. Without
        // one, `unavailable` reads as a site that cannot answer.
        return refuse("unavailable", { reason: state.state });
    }
    if (state.remainingForPerson !== null && quantity > state.remainingForPerson) return refuse("limit_reached");
    if (state.remainingInPeriod !== null && quantity > state.remainingInPeriod) return refuse("out_of_stock");

    const fields = await prisma.productVariable.findMany({ where: { productId: product.id }, take: 50 });
    const bad = invalidField(fields, request.fields);
    if (bad !== null) return refuse("field_invalid", { field: bad });
    const answers = Object.fromEntries(
        fields.map((field) => [field.name, (request.fields[field.name] ?? "").trim()]).filter(([, value]) => value !== ""),
    );

    const { subtotal, orderItems, totalDiscount, tax, total } = await priceInGame(product, quantity, ownerId, answers, now);
    const currSetting = await prisma.setting.findUnique({ where: { key: "default_currency" } });
    const currency = resolveCurrency(currSetting?.value as string);

    const needsBilling = await applyFiltersAsync("store.billing.required", false, { currency, total });
    if (needsBilling) return refuse("unavailable", { reason: "billing_required" });

    let order;
    try {
        order = await prisma.$transaction(async (tx) => {
            if (product.perPersonLimit !== null) await holdTheLimit(tx, product as unknown as ProductRow, ownerId, quantity, now, zone);
            return createCreditOrder(tx, {
                buyerId: request.buyerId,
                ownerId,
                gift,
                lines: orderItems.map((item) => ({
                    productId: item.productId,
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                    metadata: item.metadata as unknown as Prisma.InputJsonValue,
                })),
                subtotal,
                discount: totalDiscount,
                tax,
                total,
                currency,
                notes: `Bought in game (${request.channel})`,
                billingDetails: Prisma.JsonNull,
                metadata: {
                    playerName: gift ? null : request.playerName,
                    variables: { [product.id]: answers },
                    channel: request.channel,
                    ...(gift ? { gift: true, recipientId: ownerId } : {}),
                },
                playerName: request.playerName,
                description: `${gift ? "Gift" : "Purchase"} in game (${product.name} x${quantity})`,
            });
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === INSUFFICIENT_CREDITS) return refuse("insufficient_balance");
        if (message === LIMIT_REACHED) return refuse("limit_reached");
        if (message === OUT_OF_STOCK) return refuse("out_of_stock");
        log.error("[store] a purchase in game failed", { productId: product.id, error: message });
        return refuse("unavailable");
    }

    if (!gift) {
        await deliverPaidOrder(order, { name: request.playerName, id: request.playerId, userId: request.buyerId });
    } else {
        await doActionAsync("store.gift.sent", {
            senderId: request.buyerId,
            recipientId: ownerId,
            productName: product.name,
            quantity,
        }).catch((error: unknown) =>
            log.warn("[store] a gift could not be announced", { error: error instanceof Error ? error.message : String(error) }),
        );
    }
    await announceOrderCreated(order.id);
    await announceOrderCompleted(order.id);
    logActivity({
        userId: request.buyerId,
        action: "order.created",
        entity: "order",
        entityId: order.id,
        metadata: { orderNumber: order.orderNumber, total, paymentMethod: "credits", channel: request.channel, gift },
    }).catch(() => {});

    const after = await prisma.user.findUnique({ where: { id: request.buyerId }, select: { creditBalance: true } });
    return {
        ok: true,
        orderId: order.id,
        orderNumber: order.orderNumber,
        total,
        balance: Number(after?.creditBalance ?? 0),
        gift,
    };
}
