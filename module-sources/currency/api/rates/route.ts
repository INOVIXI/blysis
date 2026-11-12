import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, prisma, readJsonBody, settingsForStorage, withoutSecrets } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { RATE_PROVIDERS } from "../../lib/rate-providers";
import { RATE_CONFIG_KEY, RATE_STATUS_KEY, rateConfigSchema, readRateConfig, type RateConfig } from "../../lib/rate-config";

/**
 * Where the rates payments convert with come from.
 *
 * The screen gets the order, the switches, the interval and the bound, which
 * keys are stored (never the keys), what the last refresh did, and what each
 * source says about itself. A key field left empty on save keeps the stored
 * key, since the screen never has it to send back; `clearKeys` is how a key is
 * taken out.
 */

type KeyField = NonNullable<(typeof RATE_PROVIDERS)[number]["keyField"]>;

const KEY_FIELDS = [...new Set(RATE_PROVIDERS.flatMap((provider) => (provider.keyField ? [provider.keyField] : [])))];

const saveSchema = rateConfigSchema.extend({
    clearKeys: z.array(z.string().max(64)).max(KEY_FIELDS.length).default([]),
});

async function signedInAdmin(): Promise<NextResponse | null> {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return null;
}

/** The stored row as it is, sealed keys included. */
async function storedConfig(): Promise<Record<string, unknown>> {
    const row = await prisma.setting.findUnique({ where: { key: RATE_CONFIG_KEY } });
    const value = row?.value;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function GET() {
    const refused = await signedInAdmin();
    if (refused) return refused;

    const stored = await storedConfig();
    const { secretsConfigured } = withoutSecrets({ [RATE_CONFIG_KEY]: stored });
    const { intervalMinutes, maxChangePercent, providers } = readRateConfig(stored);
    const status = await prisma.setting.findUnique({ where: { key: RATE_STATUS_KEY } });

    return NextResponse.json({
        config: { intervalMinutes, maxChangePercent, providers },
        keysStored: secretsConfigured.map((path) => path.slice(RATE_CONFIG_KEY.length + 1)),
        status: status?.value ?? {},
        catalog: RATE_PROVIDERS.map((provider) => ({
            id: provider.id,
            name: provider.name,
            host: provider.host,
            keyField: provider.keyField ?? null,
            cadence: provider.cadence,
            freeRequestsPerMonth: provider.freeRequestsPerMonth ?? null,
            covers: provider.covers ?? null,
            approximate: provider.approximate === true,
        })),
    });
}

export async function POST(request: NextRequest) {
    const refused = await signedInAdmin();
    if (refused) return refused;

    const body = await readJsonBody(request, { fallback: null });
    if (body instanceof NextResponse) return body;
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid config" }, { status: 400 });
    }

    const stored = await storedConfig();
    const { clearKeys, ...sent } = parsed.data;
    const config: RateConfig = readRateConfig(sent);
    for (const field of KEY_FIELDS as KeyField[]) {
        if (config[field] !== "" || clearKeys.includes(field)) continue;
        config[field] = typeof stored[field] === "string" ? (stored[field] as string) : "";
    }
    const value = settingsForStorage({ [RATE_CONFIG_KEY]: config })[RATE_CONFIG_KEY] as object;

    await prisma.setting.upsert({
        where: { key: RATE_CONFIG_KEY },
        create: { key: RATE_CONFIG_KEY, value, module: "currency" },
        update: { value },
    });

    return NextResponse.json({ ok: true });
}
