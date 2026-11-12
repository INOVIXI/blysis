/**
 * The fee each payment method passes on to the buyer, as the operator sets it.
 *
 * One row per method, kept under one site setting. A method with no row uses
 * whatever its gateway offers, so removing a row is the way back to the
 * gateway's own setting rather than a way to switch the fee off; switching it
 * off is a row with `passOn` false, which outranks the gateway.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasPermission, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { listPaymentProviders } from "../../../lib/payments";
import { resolveCurrency } from "../../../lib/currency";
import { readPaymentFees } from "../../../lib/payment-fee-server";
import { FEE_TABLE_KEY, type FeeRow } from "../../../lib/payment-fee";

const feeRowSchema = z.object({
    provider: z.string().min(1).max(32),
    passOn: z.boolean(),
    // Below 100: at 100 the processor would take the whole payment, and the
    // gross-up divides by what is left.
    percent: z.number().min(0).max(99.99),
    fixed: z.number().min(0).max(100000),
    fixedCurrency: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{3}$/, "A currency is three letters")
        .transform((code) => code.toUpperCase())
        .nullable(),
});

async function refused(): Promise<NextResponse | string> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return session.user.id;
}

async function writeTable(table: Record<string, FeeRow>) {
    await prisma.setting.upsert({
        where: { key: FEE_TABLE_KEY },
        create: { key: FEE_TABLE_KEY, value: table as object, module: "store" },
        update: { value: table as object },
    });
}

/** Every method the shop offers now, with the operator's row and the gateway's own offer beside it. */
export async function GET() {
    const who = await refused();
    if (who instanceof NextResponse) return who;

    const configured = await prisma.setting.findUnique({ where: { key: "default_currency" } });
    const currency = resolveCurrency(configured?.value as string);
    const [providers, table] = await Promise.all([listPaymentProviders(currency), readPaymentFees()]);

    return NextResponse.json({
        currency,
        methods: providers.map((provider) => ({
            id: provider.id,
            label: provider.label,
            row: table[provider.id] ?? null,
            gatewayFee: provider.passOnFee ?? null,
        })),
    });
}

export async function PUT(request: NextRequest) {
    const who = await refused();
    if (who instanceof NextResponse) return who;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = feeRowSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { provider, ...row } = parsed.data;
    const table = await readPaymentFees();
    table[provider] = row;
    await writeTable(table);

    logActivity({
        userId: who,
        action: "store.payment_fee.updated",
        entity: "payment_fee",
        entityId: provider,
        metadata: { ...row },
    }).catch(() => {});

    return NextResponse.json({ row });
}

/** Back to whatever the gateway itself offers. */
export async function DELETE(request: NextRequest) {
    const who = await refused();
    if (who instanceof NextResponse) return who;

    const provider = request.nextUrl.searchParams.get("provider") ?? "";
    if (provider === "" || provider.length > 32) {
        return NextResponse.json({ error: "Name a payment method" }, { status: 400 });
    }
    const table = await readPaymentFees();
    if (!(provider in table)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    delete table[provider];
    await writeTable(table);

    logActivity({
        userId: who,
        action: "store.payment_fee.reset",
        entity: "payment_fee",
        entityId: provider,
    }).catch(() => {});

    return NextResponse.json({ reset: true });
}
