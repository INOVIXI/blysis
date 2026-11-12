/**
 * Which payment buttons the checkout page should draw.
 *
 * Public: it names the gateways an operator installed and configured, which is
 * the same thing the checkout page shows anyone who reaches it. It carries no
 * keys and no amounts.
 *
 * Each method carries the fee it passes on, in the shop's currency, so the
 * cart can show it before the buyer pays: a surcharge first seen on a
 * processor's page is a chargeback waiting. A method whose fee cannot be put
 * into this currency says so, because the checkout will refuse it.
 *
 * It also answers whether the checkout has to ask for a tax identity. The page
 * needs that before the buyer presses anything: finding out by being refused
 * means filling in the form twice.
 */
import { NextRequest, NextResponse } from "next/server";
import { applyFiltersAsync } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";
import { listPaymentProviders } from "../../lib/payments";
import { paymentFeeFor, readPaymentFees } from "../../lib/payment-fee-server";
import { resolveCurrency } from "../../lib/currency";

export async function GET(request: NextRequest) {
    const requested = request.nextUrl.searchParams.get("currency");
    // The same setting the checkout route prices an order in - asking the
    // gateways about a different currency would draw buttons for gateways that
    // cannot take the money once the order exists.
    const configured = await prisma.setting.findUnique({ where: { key: "default_currency" } });
    // The requested value comes off the query string, so it is the caller's
    // to choose; resolving it means a chosen one is used only if a gateway
    // could actually be asked about it.
    const currency = resolveCurrency(requested, configured?.value as string);

    const [listed, billingRequired, fees] = await Promise.all([
        listPaymentProviders(currency),
        // The total is not known until the cart is priced, and a module that
        // wants an identity above a threshold still gets asked again at
        // checkout, where the real number is. Zero here means "for a sale in
        // this currency, in principle".
        applyFiltersAsync("store.billing.required", false, { currency, total: 0 }),
        readPaymentFees(),
    ]);

    const providers = await Promise.all(
        listed.map(async (provider) => {
            const fee = await paymentFeeFor(provider, currency, fees);
            return fee.ok ? { ...provider, fee: fee.fee } : { ...provider, fee: null, unavailable: fee.code };
        }),
    );

    return NextResponse.json({ providers, billingRequired });
}
