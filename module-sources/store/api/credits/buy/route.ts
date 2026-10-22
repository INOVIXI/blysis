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

const buyCreditsSchema = z.object({
    /** A loose amount, for a shop that sells credits by the unit. */
    amount: z.number().int().min(1, "Minimum 1 credit").max(100000, "Maximum 100,000 credits").optional(),
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
        let description: string;

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
            description = sold.name;
        } else if (validation.data.amount) {
            // A module setting rather than a `credits_price_per_unit` row, which
            // is what this read before. Nothing wrote that row - no screen, no
            // API, no manifest default - so every site sold credits at exactly
            // the fallback and no operator could change it.
            const { creditsPricePerUnit } = await moduleSettings<{ creditsPricePerUnit: number }>("store");

            amount = validation.data.amount;
            // A per-credit price is a fraction by nature (0.013 a credit), so
            // the product of it is almost never a whole cent. Rounded here,
            // because what the gateway charges is rounded whether we do it or
            // not.
            totalAmount = Math.round(amount * creditsPricePerUnit * 100) / 100;
            description = `${amount} credits`;
        } else {
            return NextResponse.json({ error: "Choose a package or an amount" }, { status: 400 });
        }
        if (Math.round(totalAmount * 100) < 50) {
            return NextResponse.json({ error: "Minimum purchase amount is $0.50" }, { status: 400 });
        }

        // Without a named provider, take the first gateway that can hold this
        // currency. A site usually has one, and asking a buyer to choose
        // between none and one is not a choice.
        const provider =
            validation.data.provider ?? (await listPaymentProviders(currency))[0]?.id ?? "";

        if (!provider || !(await isPaymentProviderAvailable(provider, currency))) {
            return NextResponse.json(
                {
                    error: "Payments are not configured. Please contact the site administrator.",
                    code: "payment_not_configured",
                },
                { status: 503 },
            );
        }

        const buyer = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { email: true, username: true },
        });

        // The row is the reference, and everything the settlement needs: the
        // buyer's id used to be the reference, and the credits travelled as
        // metadata, which most gateways cannot carry. See `credit-top-up.ts`.
        const topUp = await prisma.creditTopUp.create({
            data: { userId: session.user.id, credits: amount, amount: totalAmount, currency, provider },
            select: { id: true },
        });

        const payment = await startPaymentSession({
            provider,
            kind: "credits",
            reference: topUp.id,
            amount: totalAmount,
            currency,
            description,
            lines: [{ name: description, quantity: 1, unitAmount: totalAmount }],
            customer: { userId: session.user.id, email: buyer?.email ?? null, name: buyer?.username ?? null },
            metadata: {
                type: "credit_purchase",
                userId: session.user.id,
                creditAmount: String(amount),
            },
            successPath: "/store?credits=purchased",
            cancelPath: "/store?credits=cancelled",
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
