/**
 * Creates a Mollie payment and hands back its checkout page.
 *
 * The buyer picks their method (iDEAL, Bancontact, card) on Mollie's side, so
 * nothing here has to know which methods this merchant has switched on.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { log, resolveAppUrl } from "@/core/sdk/server";
import { getMollieConfig, MOLLIE_API, MolliePayment, mollieValue } from "../lib/mollie";

const onPaymentSession: HookHandlerFor<"payment.session", "filter"> = async (result, request) => {
    if (result.handled || request.provider !== "mollie") return result;

    const config = await getMollieConfig();
    if (!config) return result;

    // Mollie bills a plan through its Subscriptions API, against a customer
    // with a mandate. That is a different integration, and pretending
    // otherwise would charge once for something sold monthly.
    if (request.recurring) {
        return {
            handled: true,
            redirectUrl: null,
            reference: null,
            error: "Mollie cannot take subscriptions on this site yet. Pay another way.",
        };
    }

    try {
        const baseUrl = await resolveAppUrl();
        const response = await fetch(`${MOLLIE_API}/payments`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
            body: JSON.stringify({
                amount: { currency: request.currency, value: mollieValue(request.amount, request.currency) },
                description: request.description.slice(0, 255),
                redirectUrl: request.successUrl,
                cancelUrl: request.cancelUrl,
                webhookUrl: `${baseUrl}/api/v1/mollie/webhook`,
                metadata: { ...request.metadata, reference: request.reference, kind: request.kind },
            }),
        });

        const payment = (await response.json()) as MolliePayment;
        const checkout = payment._links?.checkout?.href;
        if (!response.ok || !checkout) {
            log.error("[mollie-gateway] Mollie refused to create a payment", {
                reference: request.reference,
                error: payment.detail ?? String(response.status),
            });
            return {
                handled: true,
                redirectUrl: null,
                reference: null,
                error: "The Mollie payment could not be started. Try again shortly.",
            };
        }

        return { handled: true, redirectUrl: checkout, reference: payment.id ?? null, error: null };
    } catch (error) {
        log.error("[mollie-gateway] could not create a payment", {
            reference: request.reference,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            handled: true,
            redirectUrl: null,
            reference: null,
            error: "The Mollie payment could not be started. Try again shortly.",
        };
    }
};

export default onPaymentSession;
