/**
 * One reminder for a checkout that was started and never paid for.
 *
 * An order or a credit top-up a buyer walked away from stayed PENDING with
 * nothing following it up, which is a sale the shop had already been chosen
 * for and lost to a closed tab or a declined card. The reminder is off until
 * an operator turns it on, and when it is on it is bounded on every side:
 *
 * - Once per checkout. A row is claimed by writing `remindedAt` while it is
 *   still null, so two sweeps that overlap, or a sweep that dies between the
 *   claim and the send, can never mail the same checkout twice. A lost send
 *   is the failure this chooses over a repeated one.
 * - Only about the buyer's latest attempt. Somebody who tried three times
 *   before giving up hears about the newest one; an older one is claimed
 *   without a message, because three letters about one basket is the shop
 *   nagging. The same rule covers a buyer whose card failed and who then
 *   paid on a second try: there is nothing left to finish.
 * - Not to somebody who said no. The sweep announces the reminder as
 *   `store.checkout.reminder` and whoever delivers it asks the buyer's
 *   notification settings first; the store's own email does, and links to
 *   the switch. The checkout is claimed either way, so switching the
 *   reminders back on later does not bring old baskets back.
 * - Only recent checkouts. The sweep looks back a few days past the wait,
 *   so switching the feature on for the first time does not write to every
 *   buyer who ever left a basket.
 *
 * `an-unpaid-checkout-is-reminded-once.test.ts` holds these.
 */

import type { ActionPayload } from "@/core/sdk";

type CheckoutReminderPayload = ActionPayload<"store.checkout.reminder">;

/** How far past the wait the sweep still looks. */
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/** How many checkouts one sweep handles; the next sweep takes the rest. */
const BATCH = 100;

export interface ReminderSettings {
    checkoutReminderEnabled: boolean;
    checkoutReminderHours: number;
}

/** Which checkouts are old enough to remind about and still young enough to be worth it. */
export function reminderWindow(now: Date, hours: number): { from: Date; until: Date } {
    const wait = Math.max(1, hours) * 60 * 60 * 1000;
    const until = new Date(now.getTime() - wait);
    return { from: new Date(until.getTime() - LOOKBACK_MS), until };
}

interface OrderCandidate {
    id: string;
    orderNumber: string;
    total: unknown;
    userId: string | null;
    createdAt: Date;
}

interface TopUpCandidate {
    id: string;
    amount: unknown;
    userId: string | null;
    createdAt: Date;
}

interface PendingWhere {
    status: "PENDING";
    remindedAt: null;
    userId: { not: null };
    createdAt: { gte: Date; lte: Date };
}

interface ClaimWhere {
    id: string;
    status: "PENDING";
    remindedAt: null;
}

interface LaterAttemptWhere {
    userId: string;
    status: { in: ("PENDING" | "COMPLETED")[] };
    createdAt: { gt: Date };
}

/** The slice of the client this needs, so a test can hand in its own. */
export interface ReminderDb {
    order: {
        findMany(args: {
            where: PendingWhere;
            orderBy: { createdAt: "desc" };
            take: number;
            select: {
                id: true;
                orderNumber: true;
                total: true;
                userId: true;
                createdAt: true;
            };
        }): Promise<OrderCandidate[]>;
        updateMany(args: { where: ClaimWhere; data: { remindedAt: Date } }): Promise<{ count: number }>;
        count(args: { where: LaterAttemptWhere }): Promise<number>;
    };
    creditTopUp: {
        findMany(args: {
            where: PendingWhere;
            orderBy: { createdAt: "desc" };
            take: number;
            select: {
                id: true;
                amount: true;
                userId: true;
                createdAt: true;
            };
        }): Promise<TopUpCandidate[]>;
        updateMany(args: { where: ClaimWhere; data: { remindedAt: Date } }): Promise<{ count: number }>;
        count(args: { where: LaterAttemptWhere }): Promise<number>;
    };
}

export interface ReminderDeps {
    db: ReminderDb;
    settings: ReminderSettings;
    /** Fires `store.checkout.reminder`; its listeners decide whether and how to deliver. */
    announce: (reminder: CheckoutReminderPayload) => Promise<void>;
    now?: Date;
}

interface Checkout {
    kind: "order" | "topUp";
    id: string;
    userId: string;
    createdAt: Date;
    orderNumber: string | null;
    total: number;
}

/** Announces the reminders due now. Returns how many were announced. */
export async function sendCheckoutReminders(deps: ReminderDeps): Promise<number> {
    const { db, settings } = deps;
    if (!settings.checkoutReminderEnabled) return 0;

    const now = deps.now ?? new Date();
    const { from, until } = reminderWindow(now, settings.checkoutReminderHours);
    const where: PendingWhere = {
        status: "PENDING",
        remindedAt: null,
        userId: { not: null },
        createdAt: { gte: from, lte: until },
    };

    const [orders, topUps] = await Promise.all([
        db.order.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: BATCH,
            select: { id: true, orderNumber: true, total: true, userId: true, createdAt: true },
        }),
        db.creditTopUp.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: BATCH,
            select: { id: true, amount: true, userId: true, createdAt: true },
        }),
    ]);

    const checkouts: Checkout[] = [
        ...orders.flatMap((row): Checkout[] =>
            row.userId
                ? [{ kind: "order", id: row.id, userId: row.userId, createdAt: row.createdAt, orderNumber: row.orderNumber, total: Number(row.total) }]
                : [],
        ),
        ...topUps.flatMap((row): Checkout[] =>
            row.userId
                ? [{ kind: "topUp", id: row.id, userId: row.userId, createdAt: row.createdAt, orderNumber: null, total: Number(row.amount) }]
                : [],
        ),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const claim = async (checkout: Checkout): Promise<boolean> => {
        const table = checkout.kind === "order" ? db.order : db.creditTopUp;
        const { count } = await table.updateMany({
            where: { id: checkout.id, status: "PENDING", remindedAt: null },
            data: { remindedAt: now },
        });
        return count === 1;
    };

    // A later order or top-up that was paid, or is still waiting for its own
    // reminder. One still inside the wait counts too: it will be reminded
    // when its turn comes, and this one would be a second letter.
    const triedAgain = async (checkout: Checkout): Promise<boolean> => {
        const later: LaterAttemptWhere = {
            userId: checkout.userId,
            status: { in: ["PENDING", "COMPLETED"] },
            createdAt: { gt: checkout.createdAt },
        };
        const [orders, topUps] = await Promise.all([
            db.order.count({ where: later }),
            db.creditTopUp.count({ where: later }),
        ]);
        return orders + topUps > 0;
    };

    let sent = 0;
    for (const checkout of checkouts) {
        const remind = !(await triedAgain(checkout));
        if (!(await claim(checkout))) continue;
        if (!remind) continue;

        await deps.announce({
            userId: checkout.userId,
            kind: checkout.kind,
            id: checkout.id,
            orderNumber: checkout.orderNumber,
            total: checkout.total,
            // An order's basket was emptied when the checkout started, so
            // the link fills it again; a top-up is picked up where credits
            // are bought, the member's own credits section.
            resumePath: checkout.kind === "order"
                ? `/store/cart?restore=${encodeURIComponent(checkout.id)}`
                : "/profile?section=credits",
        });
        sent++;
    }
    return sent;
}
