/**
 * Paymentwall's pingback: the only report that a widget payment happened.
 *
 * Paymentwall keeps sending it until the body reads exactly "OK", so that word
 * is written only after the payment has been recorded. A pingback with a
 * signature that does not verify is answered with the reason, which is what
 * Paymentwall's dashboard shows the operator.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { applyFiltersAsync } from "@/core/sdk";
import { log } from "@/core/sdk/server";
import { getPaymentwallConfig, paymentwallSign, pingbackKind } from "../../lib/paymentwall";

export const dynamic = "force-dynamic";

const UNHANDLED: PaymentOutcome = { handled: false, duplicate: false, error: null };

function signatureMatches(expected: string, received: string): boolean {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(received, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
    const config = await getPaymentwallConfig();
    if (!config) return new NextResponse("PAYMENTWALL_NOT_CONFIGURED", { status: 503 });

    const params: Record<string, string> = {};
    request.nextUrl.searchParams.forEach((value, key) => {
        params[key] = value;
    });

    const received = params.sig ?? "";
    if (!received || !signatureMatches(paymentwallSign(params, config.secretKey), received)) {
        log.error("[paymentwall-gateway] a pingback arrived with a bad signature");
        return new NextResponse("BAD_SIGNATURE", { status: 400 });
    }

    const reference = params.goodsid || params.ag_external_id;
    if (!reference) return new NextResponse("OK");

    const kind = pingbackKind(params.type ?? "");

    if (kind === "deliver") {
        const outcome = await applyFiltersAsync("payment.settled", UNHANDLED, {
            kind: "order",
            reference,
            provider: "paymentwall",
            providerRef: params.ref ?? reference,
            // A digital goods pingback carries no amount. The widget URL was
            // signed with it, so Paymentwall charged what the store asked.
            amount: params.amount ? Number(params.amount) : null,
            currency: params.currency ? params.currency.toUpperCase() : null,
        });
        if (!outcome.handled) {
            log.error("[paymentwall-gateway] nothing settled a delivered payment", { reference });
            // Not "OK": Paymentwall will send it again.
            return new NextResponse("RETRY", { status: 500 });
        }
        return new NextResponse("OK");
    }

    if (kind === "withdraw") {
        const outcome = await applyFiltersAsync("payment.refunded", UNHANDLED, {
            provider: "paymentwall",
            providerRef: params.ref ?? reference,
            amount: params.amount ? Number(params.amount) : null,
        });
        if (!outcome.handled) log.warn("[paymentwall-gateway] nothing recorded a chargeback", { reference });
    }

    return new NextResponse("OK");
}
