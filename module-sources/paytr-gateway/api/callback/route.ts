/**
 * Where PayTR reports what happened to a payment.
 *
 * PayTR retries this call until it reads exactly "OK" back, which is what
 * makes the answer matter: anything else, including a 200 with a JSON body,
 * counts as not delivered. So "OK" is sent only once the payment is recorded.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { applyFiltersAsync } from "@/core/sdk";
import { log } from "@/core/sdk/server";
import { fromMerchantOid, getPaytrConfig, paytrHash } from "../../lib/paytr";

export const dynamic = "force-dynamic";

const UNHANDLED: PaymentOutcome = { handled: false, duplicate: false, error: null };

/** Constant-time compare of two base64 hashes of the same length. */
function hashesMatch(expected: string, received: string): boolean {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(received, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
    const config = await getPaytrConfig();
    if (!config) return new NextResponse("PAYTR_NOT_CONFIGURED", { status: 503 });

    const form = await request.formData();
    const merchantOid = String(form.get("merchant_oid") ?? "");
    const status = String(form.get("status") ?? "");
    const totalAmount = String(form.get("total_amount") ?? "");
    const received = String(form.get("hash") ?? "");

    if (!merchantOid || !status || !received) {
        return new NextResponse("BAD_REQUEST", { status: 400 });
    }

    const expected = paytrHash(config, merchantOid + config.merchantSalt + status + totalAmount);
    if (!hashesMatch(expected, received)) {
        log.error("[paytr-gateway] a callback arrived with a hash that does not verify", { merchantOid });
        return new NextResponse("BAD_HASH", { status: 400 });
    }

    const reference = fromMerchantOid(merchantOid);

    if (status !== "success") {
        const voided = await applyFiltersAsync("payment.voided", UNHANDLED, {
            kind: "order",
            reference,
            provider: "paytr",
        });
        // A failed payment that nobody cancelled is not worth a retry loop:
        // the order simply stays pending, which is what it already was.
        if (!voided.handled) log.warn("[paytr-gateway] nothing cancelled a failed payment", { reference });
        return new NextResponse("OK");
    }

    const outcome = await applyFiltersAsync("payment.settled", UNHANDLED, {
        kind: "order",
        reference,
        provider: "paytr",
        providerRef: merchantOid,
        // PayTR reports the settled amount in minor units, and covers it with
        // the hash. It reports no currency: that went into the hashed token
        // when the payment started, so it is the one the store charged.
        amount: Number(totalAmount) / 100,
        currency: null,
    });

    if (!outcome.handled) {
        log.error("[paytr-gateway] nothing settled a successful payment", { reference, merchantOid });
        // Not "OK": PayTR will send it again, and the money is not lost.
        return new NextResponse("RETRY", { status: 500 });
    }

    return new NextResponse("OK");
}
