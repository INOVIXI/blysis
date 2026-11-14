/**
 * Buying credits.
 *
 * Same contract as an order: the store prices the top-up and asks whichever
 * gateway the buyer picked to take the money. What comes back is a redirect,
 * and the credits are granted only when that gateway reports the payment
 * settled - never here.
 */
import { NextRequest, NextResponse } from "next/server";
import { log, moduleSettings, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";
import { startPaymentSession, isPaymentProviderAvailable, listPaymentProviders } from "../../../lib/payments";
import { resolveCurrency } from "../../../lib/currency";
import { buyableNow, packageSnapshot } from "../../../lib/credit-packages";
import { paymentFeeFor } from "../../../lib/payment-fee-server";
import { grossUpForFee } from "../../../lib/pricing";
import { bestBonus } from "../../../lib/credit-bonus";
import { runningBonusCampaigns } from "../../../lib/credit-bonus-server";
import { MIN_CHARGE, quoteTopUp, readTopUpLimits, type TopUpSettings } from "../../../lib/credit-top-up-quote";

const buyCreditsSchema = z.object({
    /**
     * A typed amount, in whole credits: the buyer types money and the screen
     * turns it into credits with `creditsFor`. What it may cost is the
     * operator's min and max, checked below in money; this bound only keeps
     * the arithmetic finite.
     */
    amount: z.number().int().min(1, "Minimum 1 credit").max(1_000_000_000).optional(),
    /** Or a package, which decides both numbers itself. */
    packageId: z.string().min(1).max(64).optional(),
    provider: z.string().min(1).max(32).optional(),
});

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Every call opens a session at the payment gateway, which costs a
        // request there whether or not anyone pays. A budget, not a
        // brute-force ceiling, so role multipliers apply.
        const rl = await rateLimitForRole(
            `credits-buy:${session.user.id}`,
            { maxRequests: 15, windowMs: 15 * 60 * 1000 },
            session.user.role,
        );
        if (!rl.success) {
            return NextResponse.json({ error: "Too many requests" }, { status: 429 });
        }

        const body = await readJsonBody(request);
        if (body instanceof NextResponse) return body;
        const validation = buyCreditsSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
        }

        const currSetting = await prisma.setting.findUnique({ where: { key: "default_currency" } });
        const currency = resolveCurrency(currSetting?.value as string);

        // Two ways to buy, and the package is the one that decides both
        // numbers for itself. What the buyer is charged and what lands in
        // their balance are read off the row here and written onto the top-up,
        // because a gateway settles minutes later - days later for a
        // transfer confirmed by hand - and an operator editing the package in
        // between must not change what somebody already bought.
        let amount: number;
        let totalAmount: number;
        // The credits a bonus campaign's percent is taken of: a package's own
        // `credits` without its fixed bonus, so no bonus is paid on a bonus.
        let baseCredits: number;
        let description: string;
        // Decided now and written on the row, never looked up at settlement:
        // a campaign that ends while the gateway is still settling must pay
        // what the buyer was shown. The tier is chosen by the price, before
        // the method's fee, because the fee is not a purchase.
        const startedAt = new Date();
        const campaigns = await runningBonusCampaigns(startedAt);
        let bonus: ReturnType<typeof bestBonus>;

        if (validation.data.packageId) {
            const pack = await prisma.creditPackage.findUnique({
                where: { id: validation.data.packageId },
            });
            if (!pack || !buyableNow(pack)) {
                return NextResponse.json(
                    { error: "That package is not for sale", code: "credit_package_unavailable" },
                    { status: 400 },
                );
            }
            const sold = packageSnapshot(pack);
            amount = sold.credits;
            totalAmount = sold.price;
            baseCredits = pack.credits;
            description = sold.name;
            // A package is the operator's own offer, so the typed limits do
            // not apply to it; the gateway's floor does.
            if (Math.round(totalAmount * 100) < Math.round(MIN_CHARGE * 100)) {
                return NextResponse.json(
                    { error: "That amount is below the smallest top-up", code: "credit_top_up_below_min", min: MIN_CHARGE },
                    { status: 400 },
                );
            }
            bonus = bestBonus(campaigns, { paid: totalAmount, baseCredits }, startedAt);
        } else if (validation.data.amount) {
            // Priced, limited and given its bonus by `quoteTopUp`, the function
            // the buyer's screen previewed it with. The limits are money, so a
            // change to the price of a credit cannot quietly move them.
            const limits = readTopUpLimits(await moduleSettings<TopUpSettings>("store"));
            const quote = quoteTopUp(validation.data.amount, limits, campaigns, startedAt);
            if (quote.refusal) {
                const { code, ...limit } = quote.refusal;
                return NextResponse.json({ error: "That amount cannot be bought", code, ...limit }, { status: 400 });
            }
            amount = quote.credits;
            baseCredits = quote.credits;
            totalAmount = quote.paid;
            description = `${amount} credits`;
            bonus = quote.bonus;
        } else {
            return NextResponse.json({ error: "Choose a package or an amount" }, { status: 400 });
        }

        // Without a named provider, take the first gateway that can hold this
        // currency. A site usually has one, and asking a buyer to choose
        // between none and one is not a choice.
        const methods = await listPaymentProviders(currency);
        const provider = validation.data.provider ?? methods[0]?.id ?? "";
        const method = methods.find((candidate) => candidate.id === provider);

        if (!provider || !method || !(await isPaymentProviderAvailable(provider, currency))) {
            return NextResponse.json(
                {
                    error: "Payments are not configured. Please contact the site administrator.",
                    code: "payment_not_configured",
                },
                { status: 503 },
            );
        }

        // The same fee an order through this method is charged, from the same
        // function: a top-up through Stripe used to cost the shop Stripe's cut
        // while an order through it did not.
        const resolvedFee = await paymentFeeFor(method, currency);
        if (!resolvedFee.ok) {
            return NextResponse.json(
                {
                    error: "That payment method cannot be used right now: its fee cannot be converted into this currency.",
                    code: resolvedFee.code,
                },
                { status: 503 },
            );
        }
        const { charged, surcharge } = resolvedFee.fee
            ? grossUpForFee(totalAmount, resolvedFee.fee)
            : { charged: totalAmount, surcharge: 0 };
        const lines = [{ name: description, quantity: 1, unitAmount: totalAmount }];
        // English, like the line an order carries: see the checkout route.
        if (surcharge > 0) lines.push({ name: "Payment processing fee", quantity: 1, unitAmount: surcharge });

        const buyer = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { email: true, username: true },
        });

        // The row is the reference, and everything the settlement needs: the
        // buyer's id used to be the reference, and the credits travelled as
        // metadata, which most gateways cannot carry. See `credit-top-up.ts`.
        const topUp = await prisma.creditTopUp.create({
            data: {
                userId: session.user.id,
                credits: amount,
                amount: totalAmount,
                fee: surcharge,
                currency,
                provider,
                bonusCredits: bonus?.credits ?? 0,
                bonusCampaignId: bonus?.campaignId ?? null,
            },
            select: { id: true },
        });

        const payment = await startPaymentSession({
            provider,
            kind: "credits",
            reference: topUp.id,
            amount: charged,
            currency,
            description,
            lines,
            customer: { userId: session.user.id, email: buyer?.email ?? null, name: buyer?.username ?? null },
            metadata: {
                type: "credit_purchase",
                userId: session.user.id,
                creditAmount: String(amount),
            },
            successPath: "/store/credits?credits=purchased",
            cancelPath: "/store/credits?credits=cancelled",
        });

        if (!payment.handled || !payment.redirectUrl) {
            return NextResponse.json(
                { error: payment.error ?? "The payment could not be started. Try again shortly." },
                { status: payment.handled ? 502 : 503 },
            );
        }

        return NextResponse.json({ redirect: payment.redirectUrl }, { status: 200 });
    } catch (error) {
        log.error("Credit purchase error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
