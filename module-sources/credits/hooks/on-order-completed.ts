/**
 * Paying a percentage of a purchase back as credits.
 *
 * It goes in through the same door anything else would use, rather than
 * writing a balance itself. That is the point of the door: the first rule to
 * write its own increment is the one that forgets the ledger row.
 *
 * The order id is the key, so an order completing twice - a retried callback,
 * an operator marking one paid that a webhook was already settling - awards
 * once.
 */
import { applyFiltersAsync } from "@/core/sdk";
import { log, siteCurrency } from "@/core/sdk/server";
import { cashbackFor, saleInBase } from "../lib/cashback";
import { cashbackPercent } from "../lib/setup";

/**
 * The part of a completed order cashback reads.
 *
 * Stated here rather than taken from `HookHandlerFor<"store.order.completed">`:
 * that shape is declared by the store, and a site that installs this module
 * without it still builds this file. Without the declaration the hook's types
 * fall back to `unknown`, and the reads below failed the whole site's build.
 * With both installed, `npm run typecheck:modules` holds these against the
 * declared contract.
 */
interface CompletedOrder {
    id: string;
    userId: string | null;
    orderNumber: string;
    total: unknown;
    currency?: string | null;
    paymentMethod?: string | null;
}

const onOrderCompleted = async (order: CompletedOrder): Promise<void> => {
    if (!order.userId) return;

    const base = await siteCurrency();
    const paidIn = (order.currency ?? "").trim().toUpperCase();
    const rate = paidIn !== "" && paidIn !== base
        ? await applyFiltersAsync("currency.rate", null, { from: paidIn, to: base }).catch(() => null)
        : null;
    const sale = saleInBase({ total: order.total, currency: order.currency }, base, typeof rate === "number" ? rate : null);
    if (sale === null) {
        log.warn("[credits] cashback skipped: no exchange rate for the order's currency", { orderId: order.id, from: paidIn, to: base });
        return;
    }

    const decision = cashbackFor(
        { total: sale, paymentMethod: order.paymentMethod },
        await cashbackPercent(),
    );
    if ("skip" in decision) return;

    const outcome = await applyFiltersAsync(
        "credits.award",
        { handled: false, duplicate: false, error: null },
        {
            userId: order.userId,
            amount: decision.award,
            reason: "cashback",
            key: order.id,
            description: `Cashback on order ${order.orderNumber}`,
        },
    );

    if (outcome.error) {
        log.error("[credits] cashback was refused", { orderId: order.id, error: outcome.error });
    }
};

export default onOrderCompleted;
