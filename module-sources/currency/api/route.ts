import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { shownRates } from "../lib/rates";

/**
 * This answer is the same whoever asked, so a proxy in front of the site may
 * hold it briefly. `s-maxage` speaks to shared caches and not to browsers, so
 * no visitor's own cache is involved. Anything here that ever starts varying
 * by who is asking has to lose this. It is also how long a refreshed fetched
 * rate takes to reach the footer: the rows are read on every answer.
 */
const SHARED_CACHE = { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" };

const SETTING_KEY = "currency_config";

const currencySchema = z.object({
    code: z.string().min(2).max(8),
    name: z.string().min(1).max(64),
    symbol: z.string().min(1).max(8),
    rate: z.number().positive(),
    enabled: z.boolean().default(true),
});

const configSchema = z.object({
    base: z.string().min(2).max(8),
    currencies: z.array(currencySchema).min(1),
    /**
     * Show prices at the fetched rates rather than the typed ones, so what a
     * buyer reads is what the checkout converts with. Off unless chosen: a
     * site that typed its rates on purpose keeps them.
     */
    useFetchedRates: z.boolean().default(false),
    /**
     * The currency a visitor who never picked one reads; empty is the base.
     * Prices stay entered in the base either way, and the checkout still
     * charges in the gateway's currency.
     */
    defaultDisplay: z.string().max(8).default(""),
    /** The same per language the page is read in, which wins over the above. */
    languageDisplay: z.record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/), z.string().max(8))
        .refine((map) => Object.keys(map).length <= 50)
        .default({}),
})
    .refine((c) => c.currencies.some((cur) => cur.code === c.base), {
        message: "Base currency must exist in currencies list",
    })
    // Two rows with the same code make every lookup ambiguous: whichever one
    // `find` reaches first wins, and which that is depends on the order they
    // happen to be stored in.
    .refine((c) => new Set(c.currencies.map((cur) => cur.code)).size === c.currencies.length, {
        message: "Two currencies cannot share a code",
    })
    // The base is the unit the others are quoted in. A base with a rate of
    // 32.5 says one of itself is worth 32.5 of itself, and every conversion
    // through it is off by that factor - so it is normalised rather than
    // rejected, and a disabled base is enabled again for the same reason.
    .transform((c) => {
        const currencies = c.currencies.map((cur) =>
            cur.code === c.base ? { ...cur, rate: 1, enabled: true } : cur,
        );
        // A default naming a currency the site does not offer would have the
        // picker showing something it cannot list, so it goes back to the
        // base: switching a currency off takes it out of every default.
        const offered = new Set(currencies.filter((cur) => cur.enabled).map((cur) => cur.code));
        return {
            ...c,
            currencies,
            defaultDisplay: offered.has(c.defaultDisplay) ? c.defaultDisplay : "",
            languageDisplay: Object.fromEntries(
                Object.entries(c.languageDisplay).filter(([, code]) => offered.has(code)),
            ),
        };
    });

/** What a save wrote, before the base is normalised. */
type StoredConfig = z.input<typeof configSchema>;

const DEFAULT_CONFIG: StoredConfig = {
    base: "USD",
    currencies: [
        { code: "USD", name: "US Dollar", symbol: "$", rate: 1.0, enabled: true },
        { code: "EUR", name: "Euro", symbol: "€", rate: 0.92, enabled: true },
        { code: "TRY", name: "Turkish Lira", symbol: "₺", rate: 32.5, enabled: true },
    ],
};

export async function GET() {
    const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    const config = (setting?.value as StoredConfig | undefined) ?? DEFAULT_CONFIG;
    const currencies = Array.isArray(config.currencies) ? config.currencies : [];

    // Only the rows this list can use, the base's among them: every rate is
    // rebased through it.
    const codes = [...new Set([config.base, ...currencies.map((c) => c.code)])].map((c) => String(c).toUpperCase());
    const rows = await prisma.exchangeRate.findMany({
        where: { currency: { in: codes } },
        select: { currency: true, rate: true },
    });
    const perDollar = new Map(rows.map((row) => [row.currency.toUpperCase(), Number(row.rate)]));
    const useFetchedRates = config.useFetchedRates === true;

    return NextResponse.json(
        { ...config, useFetchedRates, currencies: shownRates(currencies, config.base, perDollar, useFetchedRates) },
        { headers: SHARED_CACHE },
    );
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request, { fallback: null });
    if (body instanceof NextResponse) return body;
    const parsed = configSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid config" }, { status: 400 });
    }

    await prisma.setting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: parsed.data, module: "currency" },
        update: { value: parsed.data },
    });

    return NextResponse.json(parsed.data);
}
