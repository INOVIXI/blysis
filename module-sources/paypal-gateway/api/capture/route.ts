/**
 * Where PayPal sends the buyer once they have approved the payment.
 *
 * Everything this route needs was written down when the payment started, so
 * the only thing it takes from the URL is PayPal's own token. It captures the
 * money, reports it through the payment contract, and sends the buyer to the
 * page the store chose.
 */
import { NextRequest, NextResponse } from "next/server";
import { applyFiltersAsync } from "@/core/sdk";
import { prisma, log, resolveAppUrl } from "@/core/sdk/server";
import { capturePaypalOrder } from "../../lib/paypal";

export const dynamic = "force-dynamic";

async function back(path: string): Promise<NextResponse> {
    return NextResponse.redirect(new URL(path, await resolveAppUrl()));
}

export async function GET(request: NextRequest) {
    // PayPal calls its order id "token" on the return URL.
    const token = request.nextUrl.searchParams.get("token");
    if (!token) return back("/store/cart?error=missing_params");

    const pending = await prisma.paypalPayment.findUnique({ where: { paypalOrderId: token } });
    if (!pending) return back("/store/cart?error=invalid_order");

    // A reloaded return URL must not capture twice.
    if (pending.status === "COMPLETED") return back(pending.successUrl);

    try {
        const capture = await capturePaypalOrder(token);
        if (capture.status !== "COMPLETED") {
            return back(`${pending.cancelUrl}${pending.cancelUrl.includes("?") ? "&" : "?"}error=payment_failed`);
        }

        const outcome = await applyFiltersAsync(
            "payment.settled",
            { handled: false, duplicate: false, error: null },
            {
                kind: pending.kind === "credits" ? "credits" : "order",
                reference: pending.reference,
                provider: "paypal",
                providerRef: token,
                // PayPal's own figure for the capture. Falling back to what was
                // asked would be the gateway vouching for itself.
                amount: capture.amount || null,
                currency: pending.currency,
                metadata: (pending.metadata as Record<string, string>) ?? {},
            },
        );

        if (!outcome.handled) {
            // The money moved and nothing recorded it. Say so loudly: this is
            // the one failure a buyer cannot see and an operator must.
            log.error("[paypal-gateway] captured a payment nothing handled", {
                reference: pending.reference,
                paypalOrderId: token,
            });
            return back("/store/cart?error=capture_failed");
        }

        await prisma.paypalPayment.update({
            where: { id: pending.id },
            data: { status: "COMPLETED" },
        });
        return back(pending.successUrl);
    } catch (error) {
        log.error("[paypal-gateway] capture failed", {
            paypalOrderId: token,
            error: error instanceof Error ? error.message : String(error),
        });
        return back("/store/cart?error=capture_failed");
    }
}
