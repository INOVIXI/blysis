/**
 * What CoinPayments says about a hosted checkout payment.
 *
 * The signature is an HMAC over the raw form body, so the body is read as text
 * and parsed afterwards: re-encoding it first would change the bytes that were
 * signed. The merchant id in the body is checked as well - the secret proves
 * who sent it, the merchant id proves it was meant for this store - and the
 * binding in `custom` proves the payment is for what the checkout asked.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { applyFiltersAsync } from "@/core/sdk";
import { log } from "@/core/sdk/server";
import { checkoutBinding, getCoinPaymentsConfig, statusOf } from "../../lib/coinpayments";

export const dynamic = "force-dynamic";

const UNHANDLED: PaymentOutcome = { handled: false, duplicate: false, error: null };

function sameValue(expected: string, received: string): boolean {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(received, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function signatureMatches(secret: string, body: string, received: string): boolean {
    return sameValue(crypto.createHmac("sha512", secret).update(body).digest("hex"), received);
}

export async function POST(request: NextRequest) {
    const config = await getCoinPaymentsConfig();
    if (!config?.ipnSecret) {
        return NextResponse.json({ error: "CoinPayments IPN is not configured" }, { status: 503 });
    }

    const raw = await request.text();
    const received = request.headers.get("hmac");
    if (!received || !signatureMatches(config.ipnSecret, raw, received)) {
        log.error("[coinpayments-gateway] an IPN arrived with a bad signature");
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const fields = new URLSearchParams(raw);
    if (fields.get("merchant") !== config.merchantId) {
        log.error("[coinpayments-gateway] an IPN arrived for another merchant");
        return NextResponse.json({ error: "Wrong merchant" }, { status: 400 });
    }

    const reference = fields.get("item_number");
    if (!reference) return NextResponse.json({ received: true });

    const state = statusOf(Number(fields.get("status") ?? 0));

    if (state === "complete") {
        const amount = Number(fields.get("amount1") ?? 0);
        const currency = (fields.get("currency1") ?? "").toUpperCase();
        const bound = fields.get("custom") ?? "";
        if (!sameValue(checkoutBinding(config.ipnSecret, reference, amount, currency), bound)) {
            // A real payment, of something other than what the link asked
            // for: the buyer edited the checkout link. Refused, and loud,
            // because the money is now the operator's to send back.
            log.error("[coinpayments-gateway] a payment does not match the checkout it was made from", {
                reference,
                txnId: fields.get("txn_id"),
                amount,
                currency,
            });
            return NextResponse.json({ error: "Payment does not match its checkout" }, { status: 400 });
        }

        const outcome = await applyFiltersAsync("payment.settled", UNHANDLED, {
            kind: "order",
            reference,
            provider: "coinpayments",
            providerRef: fields.get("txn_id") ?? reference,
            amount,
            currency,
        });
        if (!outcome.handled) {
            log.error("[coinpayments-gateway] nothing settled a completed payment", { reference });
            // CoinPayments repeats an IPN it did not get a 200 for.
            return NextResponse.json({ error: "unhandled" }, { status: 500 });
        }
        return NextResponse.json({ received: true });
    }

    if (state === "failed") {
        const outcome = await applyFiltersAsync("payment.voided", UNHANDLED, {
            kind: "order",
            reference,
            provider: "coinpayments",
        });
        if (!outcome.handled) log.warn("[coinpayments-gateway] nothing cancelled a failed payment", { reference });
    }

    return NextResponse.json({ received: true });
}
