/**
 * The fee a payment method passes on, read from the operator's table and the
 * gateway's own offer and put into the order's currency.
 *
 * One function, asked by the checkout, by a wallet top-up and by the list of
 * methods the cart draws, so the fee a buyer is shown, the fee an order is
 * charged and the fee a top-up through the same method is charged cannot be
 * three different numbers. The rules are in `payment-fee.ts`.
 */
import { applyFiltersAsync } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";
import { FEE_TABLE_KEY, feeInOrderCurrency, feeRuleFor, readFeeTable, type FeeRow } from "./payment-fee";
import type { ProcessorFee } from "./pricing";

/** The fee to gross up for, nothing, or why the method cannot be used now. */
export type ResolvedFee = { ok: true; fee: ProcessorFee | null } | { ok: false; code: "fee_rate_unavailable" };

/** Every row the operator saved, by provider id. */
export async function readPaymentFees(): Promise<Record<string, FeeRow>> {
    const row = await prisma.setting.findUnique({ where: { key: FEE_TABLE_KEY } });
    return readFeeTable(row?.value);
}

export async function paymentFeeFor(
    provider: Pick<PaymentProviderSummary, "id" | "passOnFee">,
    currency: string,
    table?: Record<string, FeeRow>,
): Promise<ResolvedFee> {
    const rows = table ?? (await readPaymentFees());
    const rule = feeRuleFor(rows[provider.id], provider.passOnFee);
    if (!rule) return { ok: true, fee: null };

    const to = currency.toUpperCase();
    const needsRate = rule.fixed > 0 && rule.fixedCurrency !== null && rule.fixedCurrency !== to;
    const rate = needsRate
        ? await applyFiltersAsync("currency.rate", null, { from: rule.fixedCurrency as string, to })
        : null;
    const converted = feeInOrderCurrency(rule, to, rate);
    return converted.ok ? { ok: true, fee: converted.fee } : { ok: false, code: "fee_rate_unavailable" };
}
