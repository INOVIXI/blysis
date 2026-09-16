/**
 * What happens once the money has actually arrived.
 *
 * This used to live inside the Stripe webhook, which meant PayPal had a second
 * copy of it and any third gateway would have needed a third. It is the
 * store's work, not a gateway's: mark the order paid, grant what was bought,
 * record the payment, email the buyer, run the delivery commands, and tell the
 * rest of the site. A gateway only reports that money moved.
 */
import { Prisma } from "@prisma/client";
import { prisma, log, grantRole } from "@/core/sdk/server";
import { sendOrderConfirmationEmail } from "./order-email";
import { applyFiltersAsync } from "@/core/sdk";
import { deliverProduct } from "./delivery";
import { announceOrderCompleted } from "./order-events";
import { claimStock, releaseStock, stockClaims } from "./stock";
import { countSales, uncountSales } from "./popularity";
import { extendedExpiry } from "./ownership";
import { recordedPlayerName, recordedVariables } from "./chest";

const OK: PaymentOutcome = { handled: true, duplicate: false, error: null };
const ALREADY: PaymentOutcome = { handled: true, duplicate: true, error: null };

function failed(error: string): PaymentOutcome {
    return { handled: true, duplicate: false, error };
}

/**
 * The ledger row id for one credit purchase.
 *
 * Deterministic on purpose: it is the idempotency key for a top-up, enforced
 * by the primary key rather than by a search that two callers can both lose.
 */
function creditLedgerId(provider: string, providerRef: string): string {
    return `credit:${provider}:${providerRef}`;
}

/**
 * Settles an order.
 *
 * Ownership is granted here and nowhere earlier: an order is created PENDING
 * at checkout and stays that way until a gateway says it was paid for.
 */
/** The part of the client `roleGrantedBy` needs, transaction or not. */
interface RoleReader {
    role: {
        findMany(args: {
            where: { id: { in: string[] } };
            select: { id: true; priority: true };
            orderBy: { priority: "desc" };
            take: number;
        }): Promise<{ id: string; priority: number }[]>;
    };
}

/**
 * The role a paid order grants, out of everything it bought.
 *
 * One product naming a role is the ordinary case and costs nothing to answer.
 * Two is the case that goes wrong silently: a member holds one role here, so
 * something has to lose, and "whichever line came last" would hand a buyer of
 * VIP and VIP+ whichever the cart happened to sort first. The highest priority
 * wins, which is the same order the rest of the platform ranks roles by.
 */
async function roleGrantedBy(
    client: RoleReader,
    grants: { grantsRoleId: string | null; durationDays: number | null }[],
): Promise<{ roleId: string; durationDays: number | null } | null> {
    const naming = grants.filter(
        (p): p is { grantsRoleId: string; durationDays: number | null } => Boolean(p.grantsRoleId),
    );
    if (naming.length === 0) return null;

    // The duration comes from the product that granted the role, not from
    // whatever else was in the basket: a thirty-day rank bought alongside a
    // permanent one must not become permanent.
    const chosen = naming.length === 1 ? naming[0] : await highestPriority(client, naming);
    return { roleId: chosen.grantsRoleId, durationDays: chosen.durationDays };
}

/** Of several products that each grant a role, the one that outranks the rest. */
async function highestPriority<T extends { grantsRoleId: string }>(
    client: RoleReader,
    naming: T[],
): Promise<T> {
    const ranked = await client.role.findMany({
        where: { id: { in: [...new Set(naming.map((p) => p.grantsRoleId))] } },
        select: { id: true, priority: true },
        orderBy: { priority: "desc" },
        take: 1,
    });
    const top = ranked[0]?.id;
    return naming.find((p) => p.grantsRoleId === top) ?? naming[0];
}

export async function settleOrder(settlement: PaymentSettlement): Promise<PaymentOutcome> {
    const order = await prisma.order.findUnique({
        where: { id: settlement.reference },
        include: { user: { select: { email: true, username: true, locale: true } }, items: true },
    });
    if (!order) return failed("unknown order");
    // Webhooks retry, and a buyer can reload a return URL. Both arrive here.
    if (order.status === "COMPLETED") return ALREADY;

    // Order.userId is nullable: the account can be deleted between paying and
    // the webhook landing. The order is still paid, so it stays COMPLETED, but
    // there is nobody left to grant anything to.
    const buyerId = order.userId;
    const buyer = order.user;
    const granted = buyerId ? order.items.filter((item) => item.productId) : [];
    const productIds = [...new Set(granted.map((item) => item.productId as string))];

    // Marking the order paid, granting what was bought and recording the
    // payment are one transaction or none of them.
    //
    // They used to run one after another. A process that died between the
    // status update and the grants left a buyer who had paid with a COMPLETED
    // order and an empty chest - and the duplicate guard above then refused
    // every webhook retry that would have fixed it, permanently.
    //
    // The status precondition is the other half. The read above is a
    // snapshot: a gateway retry and a reloaded return URL arriving together
    // both saw PENDING, both passed it, and both granted the same order. A
    // transaction does not close that on its own, exactly as it does not for
    // the credit balance at checkout; the condition in the `where` does, by
    // leaving the second one with nothing to update.
    // One clock for the whole settlement: two products bought together should
    // not end a millisecond apart because the loop took that long.
    const now = new Date();

    // Filled inside the transaction, granted after it. A role grant leaves the
    // displayed role true as its last act, which is a second write against a
    // row this transaction does not hold, and an account deleted between
    // paying and the webhook landing must not roll back an order somebody paid
    // for.
    const roleGrants: { userId: string; roleId: string; expiresAt: Date | null }[] = [];

    const settled = await prisma.$transaction(async (tx) => {
        const claimed = await tx.order.updateMany({
            where: { id: order.id, status: { not: "COMPLETED" } },
            data: {
                status: "COMPLETED",
                paymentMethod: settlement.provider,
                paymentId: settlement.providerRef,
            },
        });
        if (claimed.count === 0) return { settled: false, short: [] as string[] };

        // Stock comes off the shelf here rather than at checkout: an order
        // nobody pays for must not hold anything. Inside the same claim as the
        // status, so a retried webhook cannot take it twice.
        const claims = stockClaims(order.items);
        const short = await claimStock(tx, claims);
        // Counted even where the shelf came up short: the unit sold, and the
        // ranking describes sales rather than what is left.
        await countSales(tx, claims);

        if (buyerId && granted.length > 0) {
            // The name and the answers travel with the item. Claiming it
            // later has no form to read them from, and the account's username
            // is the one name checkout deliberately did not use.
            const deliverTo = recordedPlayerName(order.metadata);
            await tx.chestItem.createMany({
                data: granted.map((item) => ({
                    userId: buyerId,
                    productId: item.productId as string,
                    productName: item.name,
                    quantity: item.quantity,
                    orderId: order.id,
                    playerName: deliverTo,
                    variables: recordedVariables(item.metadata) ?? Prisma.JsonNull,
                })),
            });

            // What each product grants beyond the row itself. Read here rather
            // than added to the stock query above: that one asks only about
            // products the shop counts, and widening it would make every
            // settlement carry columns the shelf has no use for.
            const grants = await tx.product.findMany({
                where: { id: { in: productIds } },
                select: { id: true, durationDays: true, grantsRoleId: true },
            });
            const timed = grants.filter((p) => p.durationDays !== null && p.durationDays > 0);
            const timedIds = new Set(timed.map((p) => p.id));
            const outright = productIds.filter((id) => !timedIds.has(id));

            // One row per product, however many of it was bought: the unique
            // key is (userId, productId), and owning it twice means nothing.
            // Still one statement for the whole order, because owning a thing
            // outright is the common case and must not cost a query a line.
            if (outright.length > 0) {
                await tx.ownedProduct.createMany({
                    data: outright.map((productId) => ({ userId: buyerId, productId, orderId: order.id })),
                    skipDuplicates: true,
                });
            }

            // A timed product has to be read before it is written: the new end
            // date depends on what is left of the old one. See `ownership.ts`
            // for why it extends rather than replaces.
            if (timed.length > 0) {
                const held = await tx.ownedProduct.findMany({
                    where: { userId: buyerId, productId: { in: [...timedIds] } },
                    select: { productId: true, expiresAt: true },
                });
                const endsAt = new Map(held.map((row) => [row.productId, row.expiresAt]));
                for (const product of timed) {
                    const expiresAt = extendedExpiry(
                        endsAt.get(product.id) ?? null,
                        product.durationDays,
                        now,
                    );
                    await tx.ownedProduct.upsert({
                        where: { userId_productId: { userId: buyerId, productId: product.id } },
                        create: { userId: buyerId, productId: product.id, orderId: order.id, expiresAt },
                        update: { expiresAt, orderId: order.id },
                    });
                }
            }

            const granting = await roleGrantedBy(tx, grants);
            if (granting) {
                // A rank is added to what the buyer already holds rather than
                // replacing it. The shape this replaces held one role per
                // member, so selling somebody a rank took away whatever else
                // they were - a moderator who bought one stopped moderating
                // until it lapsed.
                const until =
                    granting.durationDays !== null
                        ? (extendedExpiry(null, granting.durationDays, now) as Date)
                        : null;

                // Outside the transaction's `tx` on purpose: the grant leaves
                // the displayed role true as its last act, which is a second
                // write this module must not be the one to remember. An
                // account deleted between paying and the webhook landing makes
                // this throw, and the catch below keeps that from rolling back
                // an order somebody paid for.
                roleGrants.push({ userId: buyerId, roleId: granting.roleId, expiresAt: until });
            }
        }

        await tx.payment.create({
            data: {
                orderId: settlement.reference,
                provider: settlement.provider,
                providerId: settlement.providerRef,
                amount: settlement.amount,
                currency: settlement.currency.toLowerCase(),
                status: "COMPLETED",
                ...(settlement.metadata ? { metadata: settlement.metadata } : {}),
            },
        });
        return { settled: true, short };
    });

    // Another delivery of the same payment got there first.
    if (!settled.settled) return ALREADY;

    for (const grant of roleGrants) {
        try {
            await grantRole(grant.userId, grant.roleId, {
                expiresAt: grant.expiresAt,
                source: "store:product",
            });
        } catch (error) {
            // The buyer's account went between paying and this running. The
            // order is settled either way; a rank nobody can hold is not a
            // reason to fail a payment that has already been taken.
            log.error("[store] a paid rank could not be granted", {
                userId: grant.userId,
                roleId: grant.roleId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // The money moved before this ran, so a shelf that could not cover the
    // order is not something to refuse: the buyer paid and is granted what
    // they bought. It is an error because a shop that oversold will otherwise
    // hear it from a customer first.
    if (settled.short.length > 0) {
        log.error("[store] an order took more than the shelf had", {
            orderId: order.id,
            products: settled.short,
        });
    }

    if (!buyerId || !buyer) {
        log.warn("[store] order paid for by an account that no longer exists", { orderId: order.id });
        return OK;
    }

    // Neither of these may hold up the answer to the gateway: the order is
    // paid and granted either way, and a webhook left waiting gets retried.
    sendOrderConfirmationEmail({
        to: buyer.email,
        orderNumber: order.orderNumber,
        total: Number(order.total),
        locale: buyer.locale,
    }).catch((error: unknown) =>
        log.error("[store] order confirmation email failed", { orderId: order.id, error: String(error) }),
    );

    const playerName =
        settlement.metadata?.playerName ||
        ((order.metadata as Record<string, unknown>)?.playerName as string) ||
        buyer.username ||
        "Player";

    // One query for every product's commands rather than one per item: an
    // order of twelve things was twelve round trips before the buyer got a
    // reply, and a gateway webhook has a timeout.
    const commandRows = productIds.length
        ? await prisma.productCommand.findMany({
              where: { productId: { in: productIds } },
              orderBy: { order: "asc" },
          })
        : [];
    const commandsByProduct = new Map<string, typeof commandRows>();
    for (const row of commandRows) {
        const list = commandsByProduct.get(row.productId);
        if (list) list.push(row);
        else commandsByProduct.set(row.productId, [row]);
    }

    for (const item of granted) {
        const commands = commandsByProduct.get(item.productId as string);
        if (!commands || commands.length === 0) continue;

        const itemVars = (item.metadata as Record<string, unknown>)?.variables as
            | Record<string, string>
            | undefined;

        deliverProduct({
            playerName,
            productName: item.name,
            commands: commands.map((c) => ({ command: c.command, serverId: c.serverId })),
            quantity: item.quantity,
            variables: itemVars,
        }).catch((error) => log.error("[store] delivery failed", { orderId: order.id, error: String(error) }));
    }

    await announceOrderCompleted(order.id);
    return OK;
}


/**
 * Settles a wallet top-up.
 *
 * The credit amount is what the store asked the gateway to carry, not what the
 * buyer's browser said: it is read back out of the session metadata the store
 * itself wrote.
 */
export async function settleCredits(settlement: PaymentSettlement): Promise<PaymentOutcome> {
    const userId = settlement.metadata?.userId;
    const credits = Number(settlement.metadata?.creditAmount ?? 0);
    if (!userId || !(credits > 0)) return failed("credit purchase is missing its amount or buyer");

    // The gateway's own id for the money is the idempotency key, and the
    // ledger row's primary key is where it is enforced.
    //
    // Looking for the row first and writing after did not close anything: a
    // gateway retry and a reloaded return URL arriving together both found no
    // row - the search was `description: { contains: … }`, a scan of the whole
    // ledger at that - and both credited the account. Giving the row a
    // deterministic id makes the second insert a duplicate key, and the
    // transaction takes the balance increment down with it. There is no read
    // before it either: the ledger belongs to the module that keeps it, and
    // the duplicate is the answer rather than a second opinion about it.
    const ledgerId = creditLedgerId(settlement.provider, settlement.providerRef);

    try {
        // The wallet is another module's; the transaction is this one's, and
        // the deterministic id goes with the request so the duplicate key
        // still aborts it.
        await prisma.$transaction(async (tx) => {
            await applyFiltersAsync("credit.change", { applied: false }, {
                tx,
                userId,
                amount: credits,
                type: "credit_purchase",
                description: `Purchased ${credits} credits via ${settlement.provider} (${settlement.providerRef})`,
                ledgerId,
            });
        });
    } catch (error) {
        // P2002 is the unique constraint: the other delivery won the race.
        if (error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "P2002") {
            return ALREADY;
        }
        throw error;
    }

    return OK;
}

/** The buyer walked away, or the gateway's session expired. */
export async function voidOrder(reference: string): Promise<PaymentOutcome> {
    const order = await prisma.order.findUnique({ where: { id: reference } });
    if (!order) return failed("unknown order");
    // A paid order is never cancelled by a late "expired" event.
    if (order.status === "COMPLETED") return ALREADY;
    if (order.status === "CANCELLED") return ALREADY;
    await prisma.order.update({ where: { id: reference }, data: { status: "CANCELLED" } });
    return OK;
}

/** The money went back, whether the buyer asked or the operator did. */
export async function refundPayment(provider: string, providerRef: string): Promise<PaymentOutcome> {
    const payment = await prisma.payment.findFirst({ where: { provider, providerId: providerRef } });
    if (!payment) return failed("unknown payment");
    if (payment.status === "REFUNDED") return ALREADY;

    const refundedOrder = await prisma.order.findUnique({
        where: { id: payment.orderId },
        include: { items: true },
    });

    // The status precondition is what makes two refund notifications safe: the
    // read above is a snapshot, and without it both would put the same stock
    // back and the shelf would grow.
    const refunded = await prisma.$transaction(async (tx) => {
        const claimed = await tx.payment.updateMany({
            where: { id: payment.id, status: { not: "REFUNDED" } },
            data: { status: "REFUNDED" },
        });
        if (claimed.count === 0) return false;
        await tx.order.update({ where: { id: payment.orderId }, data: { status: "REFUNDED" } });
        if (refundedOrder) {
            const claims = stockClaims(refundedOrder.items);
            await releaseStock(tx, claims);
            await uncountSales(tx, claims);
        }
        return true;
    });
    return refunded ? OK : ALREADY;
}

/**
 * Records what a gateway says about a recurring plan.
 *
 * The store keeps the subscription row because access to the product is the
 * store's business; the gateway keeps the plan itself. An ended plan takes the
 * product with it, which is the whole point of selling access by the month.
 */
export async function applySubscriptionChange(change: SubscriptionChange): Promise<PaymentOutcome> {
    const existing = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: change.providerRef },
    });

    if (change.ended) {
        if (!existing) return failed("unknown subscription");
        if (existing.status === "canceled") return ALREADY;

        // Cancelling the plan and taking the product back are one step. Done
        // in sequence, a process that died between them left the plan
        // cancelled and the product still owned - and the guard above then
        // answered every retry with ALREADY, so the subscriber kept what they
        // had stopped paying for. The condition in the `where` is what makes
        // two "ended" events arriving together safe.
        const ended = await prisma.$transaction(async (tx) => {
            const claimed = await tx.subscription.updateMany({
                where: { id: existing.id, status: { not: "canceled" } },
                data: { status: "canceled", canceledAt: new Date() },
            });
            if (claimed.count === 0) return false;
            await tx.ownedProduct.deleteMany({
                where: { userId: existing.userId, productId: existing.productId },
            });
            return true;
        });
        return ended ? OK : ALREADY;
    }

    const periodEnd = change.currentPeriodEnd ? new Date(change.currentPeriodEnd) : null;

    if (existing) {
        await prisma.subscription.update({
            where: { id: existing.id },
            data: { status: change.status, ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}) },
        });
        return OK;
    }

    // Same again in the other direction: a new plan and the product it grants
    // arrive together or not at all. Written in sequence, a failure in between
    // left a subscription row with nothing granted, and the retry found that
    // row, took the branch above, and only updated its status - so the
    // subscriber paid every month for a product they never received.
    await prisma.$transaction(async (tx) => {
        await tx.subscription.create({
            data: {
                userId: change.userId,
                productId: change.productId,
                stripeSubscriptionId: change.providerRef,
                status: change.status,
                currentPeriodEnd: periodEnd ?? new Date(),
            },
        });
        await tx.ownedProduct.upsert({
            where: { userId_productId: { userId: change.userId, productId: change.productId } },
            update: {},
            create: { userId: change.userId, productId: change.productId },
        });
    });
    return OK;
}
