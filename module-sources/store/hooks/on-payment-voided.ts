/** A gateway says the buyer never paid: session expired, or they backed out. */
import type { HookHandlerFor } from "@/core/sdk";
import { log } from "@/core/sdk/server";
import { cancelPayment } from "../lib/fulfilment";

const onPaymentVoided: HookHandlerFor<"payment.voided", "filter"> = async (outcome, event) => {
    if (outcome.handled) return outcome;

    try {
        // Whether the reference is an order or a top-up is the store's to
        // know; see `settlePayment`.
        return await cancelPayment(event.reference);
    } catch (error) {
        log.error("[store] could not cancel an abandoned payment", {
            reference: event.reference,
            error: error instanceof Error ? error.message : String(error),
        });
        return { handled: false, duplicate: false, error: "cancellation failed" };
    }
};

export default onPaymentVoided;
