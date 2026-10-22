/**
 * A gateway says the money arrived.
 *
 * The answer matters: a gateway that gets `handled: false` back knows nobody
 * recorded the payment and can fail its webhook so the provider retries. That
 * is why this is a filter and not an action.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { log } from "@/core/sdk/server";
import { settlePayment } from "../lib/fulfilment";

const onPaymentSettled: HookHandlerFor<"payment.settled", "filter"> = async (outcome, settlement) => {
    // Somebody already dealt with it. Two stores on one install is not a
    // thing, but a listener that stomps on another's answer would be.
    if (outcome.handled) return outcome;

    try {
        return await settlePayment(settlement);
    } catch (error) {
        log.error("[store] could not settle a payment", {
            kind: settlement.kind,
            reference: settlement.reference,
            provider: settlement.provider,
            error: error instanceof Error ? error.message : String(error),
        });
        // Not handled: the gateway should let the provider try again rather
        // than acknowledge a payment the store failed to record.
        return { handled: false, duplicate: false, error: "settlement failed" };
    }
};

export default onPaymentSettled;
