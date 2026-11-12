/**
 * The shop's tax settings, read and written by the tax screen.
 *
 * What comes in is checked by the same reader the checkout uses, so a value
 * the rules would ignore is never stored as though it meant something.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasPermission, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { CONFIG_KEY, readTaxConfig, startingConfig } from "../../lib/config";
import { LABEL_PRESETS, readConfig } from "../../lib/rules";

const rate = z.number().min(0, "A rate cannot be below zero").max(100, "A rate cannot be above 100");

const configSchema = z.object({
    pricesIncludeTax: z.boolean(),
    defaultRate: rate,
    labelPreset: z.enum([...LABEL_PRESETS, "custom"]),
    labelText: z.string().trim().max(40),
    sellerCountry: z.union([z.literal(""), z.string().regex(/^[A-Za-z]{2}$/)]),
    countryRates: z.record(z.string().regex(/^[A-Za-z]{2}$/, "A country is a two-letter code"), rate),
    outsideArea: z.enum(["default", "zero"]),
    reverseCharge: z.boolean(),
    requireBillingAddress: z.boolean(),
    trustCountryHeader: z.boolean(),
    countryHeader: z.string().trim().regex(/^[A-Za-z0-9-]{1,64}$/, "A header name is letters, digits and hyphens"),
});

async function refused(): Promise<NextResponse | string> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "tax.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return session.user.id;
}

export async function GET() {
    const who = await refused();
    if (who instanceof NextResponse) return who;
    return NextResponse.json((await readTaxConfig()) ?? (await startingConfig()));
}

export async function PUT(request: NextRequest) {
    const who = await refused();
    if (who instanceof NextResponse) return who;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = configSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const config = readConfig(parsed.data);
    await prisma.setting.upsert({
        where: { key: CONFIG_KEY },
        create: { key: CONFIG_KEY, value: config as object, module: "tax" },
        update: { value: config as object },
    });

    logActivity({
        userId: who,
        action: "tax.settings.updated",
        entity: "tax_settings",
        entityId: CONFIG_KEY,
    }).catch(() => {});

    return NextResponse.json(config);
}
