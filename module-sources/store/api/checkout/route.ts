import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { generateOrderNumber, applyFiltersAsync } from "@/core/sdk";
import { log, logActivity, moduleSettings, prisma, rateLimitForRole, readJsonBody, siteTimeZone } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { deliverProduct } from "../../lib/delivery";
import { claimStock, shortOfStock, stockClaims } from "../../lib/stock";
import { effectivePrice } from "../../lib/availability";
import { availabilityFor, rulesOf, type ProductRow } from "../../lib/availability-server";
import { countSales } from "../../lib/popularity";
import { convertedCharge, resolveCurrency } from "../../lib/currency";
import { startPaymentSession, listPaymentProviders } from "../../lib/payments";
import { announceOrderCreated, announceOrderCompleted } from "../../lib/order-events";
import { recordedVariables } from "../../lib/chest";
import { billingRefusal, type BillingDetails } from "../../lib/billing";
import {
    computeOrderPricing,
    computeCouponDiscount,
    scopedSubtotal,
    computeCreatorDiscount,
    computeCreatorCommission,
    computeTotals,
    grossUpForFee,
} from "../../lib/pricing";
import { creditingPurchases, ownedRungsOn } from "../../lib/upgrade-credit-server";
import { z } from "zod";

/**
 * Bank a creator's cut and record it.
 *
 * The two checkout branches - paid in credits and paid at a gateway - both
 * settle a code the same way, and both had written this transaction out in
 * full. Keeping one copy is what stops the balance and the ledger row from
 * ever being credited different amounts.
 */
async function payCreatorCommission(
    code: { id: string; code: string; creatorId: string; commissionPercent: number },
    total: number,
    orderNumber: string,
) {
    const commission = computeCreatorCommission(total, code.commissionPercent);
    await prisma.$transaction(async (tx) => {
        await tx.creatorCode.update({
            where: { id: code.id },
            data: { usageCount: { increment: 1 }, totalRevenue: { increment: total } },
        });
        await applyFiltersAsync("credit.change", { applied: false }, {
            tx,
            userId: code.creatorId,
            amount: commission,
            type: "creator_commission",
            description: `Commission for order ${orderNumber} via code ${code.code}`,
        });
    });
}

const checkoutSchema = z.object({
    items: z.array(z.object({
        productId: z.string({ message: "Product is missing" }),
        quantity: z.number().int().min(1, "Quantity must be at least 1"),
    }), { message: "Your cart is empty" }).min(1, "Your cart is empty"),
    playerName: z.string().min(1, "Player name is required").max(50, "Player name is too long"),
    couponCode: z.string().optional(),
    creatorCode: z.string().optional(),
    variables: z.record(z.string(), z.record(z.string(), z.string())).optional(),
    notes: z.string().optional(),
    // Any installed gateway's id, or "credits" for the wallet the store runs
    // itself. Checked against the installed gateways below rather than against
    // a list written here: the whole point of the payment contract is that
    // this file does not know which gateways exist.
    paymentMethod: z.string().min(1).max(32).default("stripe"),
    /**
     * Who to make the invoice out to. Bounded here and checked for
     * completeness below, once the store knows whether anything reads it.
     */
    billingDetails: z.object({
        kind: z.enum(["individual", "company"]),
        name: z.string().max(200),
        taxNumber: z.string().max(40),
        taxOffice: z.string().max(120),
        address: z.string().max(300),
        city: z.string().max(120),
        country: z.string().max(60),
    }).optional(),
});

// POST /api/v1/store/checkout - Create checkout session
export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Every call opens a session at the payment gateway, which costs a
        // request there whether or not anyone pays. A budget, not a
        // brute-force ceiling, so role multipliers apply.
        const rl = await rateLimitForRole(
            `store-checkout:${session.user.id}`,
            { maxRequests: 20, windowMs: 15 * 60 * 1000 },
            session.user.role,
        );
        if (!rl.success) {
            return NextResponse.json({ error: "Too many requests" }, { status: 429 });
        }

        const body = await readJsonBody(request);
        if (body instanceof NextResponse) return body;
        const validation = checkoutSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
        }

        const { items, playerName, couponCode, creatorCode, variables, notes, paymentMethod } = validation.data;
        const sentBilling = validation.data.billingDetails as BillingDetails | undefined;

        // ── Fetch products ──
        const productIds = items.map((i) => i.productId);
        const products = await prisma.product.findMany({
            where: { id: { in: productIds }, isActive: true },
            include: { category: { select: { id: true } } },
        });

        if (products.length !== items.length) {
            return NextResponse.json({ error: "Some products are not available" }, { status: 400 });
        }

        // ── Check each product is for sale, to this person, right now ──
        //
        // The list and the buy button ask the same question, but this is the
        // one that has to be true: a limit enforced only where a browser can
        // see it is not a limit. A window that closed while somebody sat on
        // the checkout page closes here too.
        const zone = await siteTimeZone();
        const now = new Date();
        for (const product of products) {
            const wanted = items.find((i) => i.productId === product.id)?.quantity ?? 1;
            const state = await availabilityFor(prisma, product as unknown as ProductRow, session.user.id, now, zone);
            if (!state.buyable) {
                return NextResponse.json(
                    {
                        error: `${product.name}: ${state.state}`,
                        code: `store_${state.state}`,
                        productId: product.id,
                        opensAt: state.opensAt,
                    },
                    { status: 409 },
                );
            }
            if (state.remainingForPerson !== null && wanted > state.remainingForPerson) {
                return NextResponse.json(
                    {
                        error: `${product.name}: limit_reached`,
                        code: "store_limit_reached",
                        productId: product.id,
                        remaining: state.remainingForPerson,
                    },
                    { status: 409 },
                );
            }
            if (state.remainingInPeriod !== null && wanted > state.remainingInPeriod) {
                return NextResponse.json(
                    {
                        error: `${product.name}: sold_out_for_now`,
                        code: "store_sold_out_for_now",
                        productId: product.id,
                        opensAt: state.opensAt,
                    },
                    { status: 409 },
                );
            }
        }

        // ── Check subscription constraints ──
        const subscriptionProducts = products.filter((p) => p.type === "SUBSCRIPTION");
        if (subscriptionProducts.length > 1) {
            return NextResponse.json({ error: "Only one subscription product per checkout is allowed" }, { status: 400 });
        }
        if (subscriptionProducts.length === 1 && items.length > 1) {
            return NextResponse.json({ error: "Subscription products must be purchased separately" }, { status: 400 });
        }
        const isSubscriptionCheckout = subscriptionProducts.length === 1;

        // Subscriptions cannot be paid with credits
        if (isSubscriptionCheckout && paymentMethod === "credits") {
            return NextResponse.json({ error: "Subscriptions cannot be paid with credits" }, { status: 400 });
        }

        // ── Validate product variables ──
        const allVariables = await prisma.productVariable.findMany({
            where: { productId: { in: productIds } },
        });
        for (const v of allVariables) {
            if (v.required) {
                const val = variables?.[v.productId]?.[v.name];
                if (!val || val.trim() === "") {
                    return NextResponse.json({
                        error: `${v.label} is required for product`,
                    }, { status: 400 });
                }
            }
        }

        // ── Fetch bulk discounts ──
        // No ordering: the rung is the best one the quantity reaches, chosen
        // by the same function the product page quotes from, so the order
        // they arrive in stopped mattering.
        const bulkDiscounts = await prisma.bulkDiscount.findMany({
            where: { isActive: true },
        });

        // ── Cumulative upgrade check ──
        // The same set every screen ahead of this one asked for, so the price
        // quoted on the card, the product page, the cart and the comparison
        // table is the price taken here. It is empty where the operator has
        // turned the credit off, and a lapsed purchase stops crediting.
        const ownedIds = await creditingPurchases(session.user.id);

        // ── Calculate item prices (with bulk discounts + cumulative upgrades) ──
        const { subtotal, orderItems } = computeOrderPricing({
            items,
            products: products.map((p) => ({
                id: p.id,
                name: p.name,
                type: p.type,
                // What a sale sets, not what the column says: the shop shows
                // the sale price and a checkout that charged the other one
                // would be taking a different amount from the one on screen.
                price: effectivePrice(rulesOf(p as unknown as ProductRow), now).price,
                categoryId: p.categoryId,
            })),
            bulkDiscounts,
            ownedProductIds: ownedIds,
            // From the shelf, not the basket: the rung somebody stands on is
            // the one product an upgrade does not contain.
            ownedRungs: await ownedRungsOn(products.map((p) => p.categoryId), ownedIds, now),
            variables,
        });

        // ── Apply coupon ──
        // If the user supplied a coupon code, reject the checkout with a
        // clear error when it doesn't apply (not found / inactive /
        // expired / usage cap / min-purchase). Previously an invalid
        // code was silently ignored - the customer paid full price with
        // no feedback that their code didn't work.
        let couponDiscount = 0;
        if (couponCode) {
            const { enableCoupons } = await moduleSettings<{ enableCoupons: boolean }>("store");
            if (!enableCoupons) {
                return NextResponse.json(
                    { error: "Coupon codes are not accepted", code: "coupons_off" },
                    { status: 400 },
                );
            }
            const couponError = await prisma.$transaction(async (tx): Promise<string | null> => {
                const coupon = await tx.coupon.findUnique({
                    where: { code: couponCode.toUpperCase() },
                });
                // Only the part of the basket the offer covers. A coupon
                // naming no product and no category covers all of it, which
                // is what every coupon written before there was a way to say
                // otherwise covers.
                const eligible = scopedSubtotal(
                    coupon ?? {},
                    orderItems.map((item) => ({
                        productId: item.productId,
                        price: item.price,
                        quantity: item.quantity,
                    })),
                    products.map((product) => ({ id: product.id, categoryId: product.categoryId ?? null })),
                );
                const { code, discount } = computeCouponDiscount(coupon, subtotal, new Date(), eligible);
                if (code) return code;
                // Claim the use conditionally. The count read above is a
                // snapshot, so two orders redeeming the last use of a
                // single-use coupon both passed the check and both got the
                // discount. Welcome coupons and wheel prizes are issued with
                // usageLimit 1, so that is the common case, not the rare one.
                const claimed = await tx.coupon.updateMany({
                    where: {
                        id: coupon!.id,
                        ...(coupon!.usageLimit ? { usageCount: { lt: coupon!.usageLimit } } : {}),
                    },
                    data: { usageCount: { increment: 1 } },
                });
                if (claimed.count === 0) return "coupon_used_up";
                couponDiscount = discount;
                return null;
            });
            if (couponError) {
                // The code is the message: what a shopper reads is chosen
                // where their language is known, which is not here.
                return NextResponse.json({ error: couponError, code: couponError }, { status: 400 });
            }
        }

        // ── Apply creator code ──
        let creatorDiscount = 0;
        let creatorCodeRecord: { id: string; code: string; creatorId: string; commissionPercent: number } | null = null;
        if (creatorCode) {
            const code = await prisma.creatorCode.findUnique({
                where: { code: creatorCode.toUpperCase() },
            });
            // Skip codes whose creator was deleted (creatorId becomes null on
            // user delete via SetNull); the discount + commission both require
            // a payable creator.
            if (code && code.isActive && code.creatorId && code.creatorId !== session.user.id) {
                // Only the part the code covers. A code naming nothing covers
                // the basket, which is what every code issued before there
                // was a way to say otherwise covers.
                const eligible = scopedSubtotal(
                    code,
                    orderItems.map((item) => ({
                        productId: item.productId,
                        price: item.price,
                        quantity: item.quantity,
                    })),
                    products.map((product) => ({ id: product.id, categoryId: product.categoryId ?? null })),
                );
                creatorDiscount = computeCreatorDiscount(subtotal, couponDiscount, code.discountPercent, eligible);
                // A code that covered nothing in this basket earns its
                // creator nothing either: the commission is a share of what
                // the code actually moved.
                if (creatorDiscount > 0 || eligible > 0) {
                    creatorCodeRecord = {
                        id: code.id,
                        code: code.code,
                        creatorId: code.creatorId,
                        commissionPercent: code.commissionPercent,
                    };
                }
            }
        }

        // ── Tax calculation ──
        // The rate is the store module's own setting now. It used to be a
        // row among the site's settings, which is the wrong home for a shop's
        // own figure and left the "prices already include tax" switch with
        // nowhere to sit beside it - and an operator can set one of those
        // without the other only by accident.
        const { taxRate, taxIncluded } = await moduleSettings<{
            taxRate: number;
            taxIncluded: boolean;
        }>("store");
        const currSetting = await prisma.setting.findUnique({ where: { key: "default_currency" } });
        const currency = resolveCurrency(currSetting?.value as string).toLowerCase();

        const { totalDiscount, tax, total } = computeTotals({
            subtotal,
            couponDiscount,
            creatorDiscount,
            taxRate,
            taxIncluded,
        });

        // Who the invoice is made out to, if anything here issues one. Asked
        // before the money moves: afterwards these cannot be asked for at all.
        const needsBilling = await applyFiltersAsync("store.billing.required", false, {
            currency: currency.toUpperCase(),
            total,
        });
        const billingAnswer = billingRefusal(needsBilling, sentBilling);
        if ("missing" in billingAnswer) {
            return NextResponse.json(
                {
                    error: "Some invoice details are missing",
                    code: "billing_details_missing",
                    missing: billingAnswer.missing,
                },
                { status: 400 },
            );
        }
        // Prisma reads a JSON column as one type and writes it as another:
        // what comes back as null goes in as JsonNull.
        const billingDetails = billingAnswer.billing
            ? (billingAnswer.billing as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull;

        // ── Credits payment ──
        if (paymentMethod === "credits") {
            const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { creditBalance: true } });
            const balance = Number(user?.creditBalance || 0);

            if (balance < total) {
                return NextResponse.json({
                    error: `Insufficient credit balance. You have ${balance.toFixed(2)} credits but need ${total.toFixed(2)}.`,
                }, { status: 400 });
            }

            // Atomic transaction: deduct credits, create order, grant ownership
            const buyerId = session.user.id;
            const order = await prisma.$transaction(async (tx) => {
                // Deduct credits, conditional on the balance still covering
                // it, and on this transaction.
                //
                // The read above is a snapshot: two checkouts submitted
                // together both saw the same balance, both passed the check,
                // and both got their goods while the balance went negative.
                // A transaction alone does not close that - under read
                // committed both decrements apply. The condition is what makes
                // the second one find nothing to update, and it lives with the
                // wallet now: every debit is conditional there, written once
                // by the module that owns the balance rather than three times
                // by the modules that spend it.
                const debited = await applyFiltersAsync("credit.change", { applied: false }, {
                    tx,
                    userId: buyerId,
                    amount: -total,
                    type: "purchase",
                    description: `Store purchase (${orderItems.map((i) => i.name).join(", ")})`,
                });
                if (!debited.applied) {
                    throw new Error("INSUFFICIENT_CREDITS");
                }

                // The shelf and the money move together or neither does. A
                // failure here rolls the debit back, which is why this is the
                // one path that can refuse: nothing has left the buyer's
                // account until this transaction commits.
                const claims = stockClaims(orderItems);
                const short = await claimStock(tx, claims);
                if (short.length > 0) {
                    throw new Error("OUT_OF_STOCK");
                }
                // This path completes the order here rather than at a
                // gateway's word, so the sale is counted here too.
                await countSales(tx, claims);

                // Create order
                const ord = await tx.order.create({
                    data: {
                        orderNumber: generateOrderNumber(),
                        userId: session.user.id,
                        status: "COMPLETED",
                        subtotal,
                        discount: totalDiscount,
                        billingDetails,
                        tax,
                        total,
                        currency: currency.toUpperCase(),
                        notes,
                        paymentMethod: "credits",
                        metadata: { playerName, variables: variables || {}, creatorCode: creatorCodeRecord?.code || null },
                        items: { create: orderItems },
                    },
                });

                // Grant ownership. Two statements rather than two per item:
                // a twelve-item order held the transaction - and the row lock
                // on the buyer's balance - open for twenty-four round trips.
                await tx.chestItem.createMany({
                    data: orderItems.map((item) => ({
                        userId: buyerId,
                        productId: item.productId,
                        productName: item.name,
                        quantity: item.quantity,
                        orderId: ord.id,
                        // Claiming this later has no form to read from, and
                        // the account's username is the one name the buyer
                        // was deliberately not asked for.
                        playerName,
                        variables: recordedVariables(item.metadata) ?? Prisma.JsonNull,
                    })),
                });
                await tx.ownedProduct.createMany({
                    data: [...new Set(orderItems.map((item) => item.productId))].map((productId) => ({
                        userId: buyerId,
                        productId,
                        orderId: ord.id,
                    })),
                    skipDuplicates: true,
                });

                return ord;
            });

            // ── RCON delivery for credits payment ──
            // One query for every product in the order, not one per item.
            const deliverable = orderItems.filter((item) => item.productId);
            const commandRows = deliverable.length
                ? await prisma.productCommand.findMany({
                      where: { productId: { in: [...new Set(deliverable.map((i) => i.productId))] } },
                      orderBy: { order: "asc" },
                  })
                : [];
            const commandsByProduct = new Map<string, typeof commandRows>();
            for (const row of commandRows) {
                const list = commandsByProduct.get(row.productId);
                if (list) list.push(row);
                else commandsByProduct.set(row.productId, [row]);
            }

            for (const item of deliverable) {
                const commands = commandsByProduct.get(item.productId);
                if (commands && commands.length > 0) {
                    const itemVars = (item.metadata as Record<string, unknown>)?.variables as Record<string, string> | undefined;
                    deliverProduct({
                        playerName,
                        productName: item.name,
                        commands: commands.map((c) => ({ command: c.command, serverId: c.serverId })),
                        quantity: item.quantity,
                        variables: itemVars,
                    }).catch((err: unknown) => log.error("[store] a checkout side effect failed", { error: err instanceof Error ? err.message : String(err) }));
                }
            }

            // ── Update creator code stats ──
            if (creatorCodeRecord) {
                await payCreatorCommission(creatorCodeRecord, total, order.orderNumber);
            }

            // ── Clear cart ──
            await prisma.cartItem.deleteMany({ where: { userId: session.user.id } });

            // ── Audit log + Discord ──
            logActivity({
                userId: session.user.id,
                action: "order.created",
                entity: "order",
                entityId: order.id,
                metadata: { orderNumber: order.orderNumber, total, paymentMethod: "credits" },
            }).catch((err: unknown) => log.error("[store] a checkout side effect failed", { error: err instanceof Error ? err.message : String(err) }));

            await announceOrderCreated(order.id);
            await announceOrderCompleted(order.id);
            return NextResponse.json({ order, redirect: null, message: "Order completed with credits" }, { status: 201 });
        }

        // Nothing is held for a PENDING order, so this cannot promise the
        // shelf will still cover it when the money lands - the conditional
        // take at settlement decides that. It is here so a shopper hears "we
        // are out of that" before a payment page rather than after.
        const unavailable = await shortOfStock(prisma, stockClaims(orderItems));
        if (unavailable.length > 0) {
            return NextResponse.json(
                { error: "One of these is no longer in stock.", code: "out_of_stock" },
                { status: 409 },
            );
        }

        // ── Create order (PENDING -- NO ownership granted yet) ──
        const order = await prisma.order.create({
            data: {
                orderNumber: generateOrderNumber(),
                userId: session.user.id,
                status: "PENDING",
                subtotal,
                discount: totalDiscount,
                tax,
                total,
                currency: currency.toUpperCase(),
                billingDetails,
                notes,
                paymentMethod,
                metadata: { playerName, variables: variables || {}, creatorCode: creatorCodeRecord?.code || null },
                items: { create: orderItems },
            },
        });

        // ── Update creator code stats ──
        if (creatorCodeRecord) {
            await payCreatorCommission(creatorCodeRecord, total, order.orderNumber);
        }

        // ── Clear cart ──
        await prisma.cartItem.deleteMany({ where: { userId: session.user.id } });

        // ── Audit log ──
        logActivity({
            userId: session.user.id,
            action: "order.created",
            entity: "order",
            entityId: order.id,
            metadata: { orderNumber: order.orderNumber, total },
        }).catch((err: unknown) => log.error("[store] a checkout side effect failed", { error: err instanceof Error ? err.message : String(err) }));

        await announceOrderCreated(order.id);

        // ── Free order: complete & grant immediately ──
        // CRITICAL: separated from the "no gateway" path below. If a paid
        // order arrives and no gateway can take it, refuse it instead of
        // silently giving the product away.
        if (total <= 0) {
            // One transaction, like the credits path above and the gateway
            // path in settleOrder: completing the order and granting what it
            // holds either both happen or neither does. Done in sequence, a
            // process that died in between left a COMPLETED order with an
            // empty chest and nothing that would ever go back and fix it.
            const freeBuyerId = session.user.id;
            await prisma.$transaction(async (tx) => {
                await tx.order.update({ where: { id: order.id }, data: { status: "COMPLETED" } });
                await tx.chestItem.createMany({
                    data: orderItems.map((item) => ({
                        userId: freeBuyerId,
                        productId: item.productId,
                        productName: item.name,
                        quantity: item.quantity,
                        orderId: order.id,
                        playerName,
                        variables: recordedVariables(item.metadata) ?? Prisma.JsonNull,
                    })),
                });
                await tx.ownedProduct.createMany({
                    data: [...new Set(orderItems.map((item) => item.productId))].map((productId) => ({
                        userId: freeBuyerId,
                        productId,
                        orderId: order.id,
                    })),
                    skipDuplicates: true,
                });
            });

            await announceOrderCompleted(order.id);
            return NextResponse.json({ order, redirect: null, message: "Order completed (free)" }, { status: 201 });
        }

        // A paid order whose gateway is not installed or not configured stays
        // PENDING, and nothing is granted.
        const chosen = (await listPaymentProviders(currency)).find((p) => p.id === paymentMethod);
        if (!chosen) {
            return NextResponse.json(
                {
                    error: "That payment method is not available. Ask an administrator to set up a payment gateway.",
                    code: "payment_not_configured",
                },
                { status: 503 },
            );
        }

        const buyer = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { email: true, username: true },
        });

        const lines = orderItems.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            unitAmount: item.price,
        }));
        if (tax > 0) {
            // Only when it is added on top. Tax already inside the prices is
            // inside the line amounts too, and sending it again would charge
            // the buyer for it twice.
            if (!taxIncluded) {
                lines.push({ name: `Tax (${taxRate}%)`, quantity: 1, unitAmount: tax });
            }
        }

        // What a gateway costs, when its operator chose to pass it on. Grossed
        // up rather than added: the processor takes its cut of the larger
        // amount too, so adding the percentage leaves the shop short by almost
        // exactly the fee it was avoiding. See `grossUpForFee`.
        const { charged, surcharge } = chosen.passOnFee
            ? grossUpForFee(total, chosen.passOnFee)
            : { charged: total, surcharge: 0 };
        if (surcharge > 0) {
            // Named rather than folded into the total: a charge a buyer cannot
            // account for is a chargeback waiting.
            //
            // English, like the tax line above it. These are handed to a
            // processor to print on its own checkout, not rendered by us, and
            // they travel with no locale; translating one of the two would
            // leave a receipt reading half in each.
            lines.push({ name: "Payment processing fee", quantity: 1, unitAmount: surcharge });
        }

        // A gateway that only settles in its own currency is handed a
        // converted amount, or nothing at all. Charging its currency with the
        // shop's number is the failure that looks like it worked: 100 becomes
        // 100 in a currency worth a fraction of it, and the order is paid.
        const settleIn = chosen.settlesIn ? resolveCurrency(chosen.settlesIn) : currency;
        let settleAmount = charged;
        if (settleIn !== currency) {
            const rate = await applyFiltersAsync("currency.rate", null, {
                from: currency,
                to: settleIn,
            });
            const converted = convertedCharge(charged, rate);
            if (converted === null) {
                // The order keeps its PENDING row and nothing is granted, so
                // an operator can fix the rate and the buyer can try again.
                return NextResponse.json(
                    {
                        error: "That payment method cannot be used right now: the exchange rate is unavailable.",
                        code: "exchange_rate_unavailable",
                    },
                    { status: 503 },
                );
            }
            settleAmount = converted;
        }

        const subProduct = isSubscriptionCheckout ? subscriptionProducts[0] : null;

        const payment = await startPaymentSession({
            provider: paymentMethod,
            kind: subProduct ? "subscription" : "order",
            reference: order.id,
            amount: settleAmount,
            currency: settleIn,
            description: `Order ${order.orderNumber}`,
            lines,
            customer: {
                userId: session.user.id,
                email: buyer?.email ?? null,
                name: buyer?.username ?? null,
            },
            // The discount travels as a total, not as a negative line: most
            // gateways reject a negative amount outright.
            metadata: {
                orderId: order.id,
                // What the buyer sees on their confirmation. A gateway that
                // puts a reference on a statement, or asks the buyer to quote
                // one, needs the readable number rather than the row id.
                orderNumber: order.orderNumber,
                userId: session.user.id,
                playerName,
                ...(totalDiscount > 0 ? { discount: totalDiscount.toFixed(2) } : {}),
            },
            ...(subProduct
                ? {
                      recurring: {
                          interval: (subProduct.subscriptionInterval as "month" | "year") || "month",
                          intervalCount: subProduct.subscriptionIntervalCount || 1,
                          productId: subProduct.id,
                      },
                  }
                : {}),
        });

        if (!payment.handled || !payment.redirectUrl) {
            return NextResponse.json(
                {
                    error: payment.error ?? "The payment could not be started. Try again shortly.",
                    code: payment.handled ? "payment_failed" : "payment_not_configured",
                },
                { status: payment.handled ? 502 : 503 },
            );
        }

        if (payment.reference) {
            await prisma.order.update({ where: { id: order.id }, data: { paymentId: payment.reference } });
        }

        return NextResponse.json({ order, redirect: payment.redirectUrl }, { status: 201 });
    } catch (error) {
        // The conditional debit lost the race: another checkout spent the
        // balance between the read and the write. Same answer the read gave
        // when it saw too little, not a 500.
        if (error instanceof Error && error.message === "OUT_OF_STOCK") {
            return NextResponse.json(
                { error: "One of these is no longer in stock.", code: "out_of_stock" },
                { status: 409 },
            );
        }
        if (error instanceof Error && error.message === "INSUFFICIENT_CREDITS") {
            return NextResponse.json(
                { error: "Insufficient credit balance." },
                { status: 400 },
            );
        }
        log.error("Checkout error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
