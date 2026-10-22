/**
 * Builds a CoinPayments hosted checkout link.
 *
 * There is no API call here: the payment is a URL, and everything the store
 * needs back arrives on the IPN. The reference travels as `item_number`, which
 * CoinPayments echoes verbatim.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { resolveAppUrl } from "@/core/sdk/server";
import { checkoutBinding, COINPAYMENTS_CHECKOUT, getCoinPaymentsConfig } from "../lib/coinpayments";

const onPaymentSession: HookHandlerFor<"payment.session", "filter"> = async (result, request) => {
    if (result.handled || request.provider !== "coinpayments") return result;

    const config = await getCoinPaymentsConfig();
    if (!config?.ipnSecret) return result;

    if (request.recurring) {
        return {
            handled: true,
            redirectUrl: null,
            reference: null,
            error: "Crypto cannot be used for a subscription. Pay by card instead.",
        };
    }

    const baseUrl = await resolveAppUrl();
    const params = new URLSearchParams({
        cmd: "_pay_simple",
        reset: "1",
        merchant: config.merchantId,
        item_name: request.description.slice(0, 120),
        item_number: request.reference,
        currency: request.currency,
        amountf: request.amount.toFixed(2),
        // The amount above is the buyer's to edit; this is not. See `checkoutBinding`.
        custom: checkoutBinding(config.ipnSecret, request.reference, request.amount, request.currency),
        want_shipping: "0",
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        ipn_url: `${baseUrl}/api/v1/coinpayments/ipn`,
    });

    return {
        handled: true,
        redirectUrl: `${COINPAYMENTS_CHECKOUT}?${params.toString()}`,
        reference: request.reference,
        error: null,
    };
};

export default onPaymentSession;
