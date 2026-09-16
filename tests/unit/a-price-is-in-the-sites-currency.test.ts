import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * Money on this site is written in the currency the site charges in.
 *
 * There used to be four answers to "what currency is this?" and none of them
 * was the setting the payment gateways read.
 *
 *   - Checkout, credits and the payment-provider list all charge in the
 *     `default_currency` setting. That is the real one.
 *   - The store's admin screens called `formatCurrency(x)` with no arguments,
 *     which is `Intl.NumberFormat("en-US", { currency: "USD" })`. A shop
 *     charging in lira showed every order, product, coupon and gift code as
 *     `$1,250.00`, and the buyer's own order history said the same. The
 *     number was not converted: it was the lira figure with a dollar sign.
 *   - The admin dashboard's revenue card and the analytics charts glued a
 *     `$` on by hand.
 *   - The store and the leaderboard each shipped a `CurrencyProvider` that
 *     nothing ever mounted, so every `useCurrency()` in those modules fell
 *     through to a default context whose formatter was
 *     `` `$${amount.toFixed(2)}` ``. The currency module mounted a fourth
 *     provider app-wide that no other module could import, which is why its
 *     footer picker changed nothing on any page.
 *
 * `useSiteCurrency` in `@/core/sdk/ui` is the single answer now: the base is
 * `default_currency`, the formatting follows the reader's locale, and a
 * module that knows exchange rates calls `setDisplay({ code, rate })`.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["src/app", "src/core", "module-sources"];

function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
}

const screens = () => SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const rel = (f: string) => path.relative(ROOT, f);

/**
 * A currency symbol written into a template literal right before a number.
 * `$` in `${...}` is not one, which is why this looks for the symbol as a
 * literal character immediately followed by an interpolation.
 */
const HARDCODED_SYMBOL = /[$€£₺₽¥](?=\$\{)/;

/**
 * The source with its comments removed. The prose describing this bug quotes
 * the shapes it is about, and a scan that reads comments finds its own
 * documentation.
 */
function code(source: string): string {
    return stripComments(source);
}

/** The argument list of each `formatCurrency(...)` call, parens balanced. */
function formatCurrencyArgs(source: string): string[] {
    const args: string[] = [];
    for (const match of source.matchAll(/formatCurrency\(/g)) {
        let depth = 1;
        let i = (match.index ?? 0) + match[0].length;
        const start = i;
        for (; i < source.length && depth > 0; i++) {
            if (source[i] === "(") depth++;
            else if (source[i] === ")") depth--;
        }
        args.push(source.slice(start, i - 1));
    }
    return args;
}

/** Commas that separate arguments, not ones nested inside one. */
function argCount(args: string): number {
    if (!args.trim()) return 0;
    let depth = 0;
    let count = 1;
    for (const ch of args) {
        if ("([{".includes(ch)) depth++;
        else if (")]}".includes(ch)) depth--;
        else if (ch === "," && depth === 0) count++;
    }
    return count;
}

/** Where `formatCurrency` is wrapped once so nothing else has to call it. */
const THE_WRAPPER = "src/core/components/currency/site-currency.tsx";

describe("a screen that shows money", () => {
    it("never glues a currency symbol onto a number", () => {
        const offenders: string[] = [];
        for (const file of screens()) {
            const source = code(fs.readFileSync(file, "utf8"));
            for (const line of source.split("\n")) {
                if (HARDCODED_SYMBOL.test(line)) offenders.push(`${rel(file)}: ${line.trim()}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("never calls formatCurrency without saying which currency", () => {
        // `formatCurrency(amount)` alone is USD in en-US. The default exists
        // for a caller that genuinely means USD; a screen never does.
        const offenders: string[] = [];
        for (const file of screens()) {
            if (rel(file) === THE_WRAPPER) continue;
            for (const args of formatCurrencyArgs(code(fs.readFileSync(file, "utf8")))) {
                if (argCount(args) < 2) offenders.push(`${rel(file)}: formatCurrency(${args})`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("passes the currency and the locale where it is wrapped", () => {
        const args = formatCurrencyArgs(code(read(THE_WRAPPER)));
        expect(args.length).toBeGreaterThan(0);
        for (const call of args) expect(argCount(call)).toBe(3);
    });
});

describe("the currency contract", () => {
    it("publishes the currency the gateways charge in", () => {
        const source = read("src/app/api/v1/public-settings/route.ts");
        const block = code(source.slice(source.indexOf("PUBLIC_KEYS"), source.indexOf("PUBLIC_SETTINGS_CACHE_KEY")));
        const keys = [...block.matchAll(/^\s*"([\w_]+)",$/gm)].map((m) => m[1]);
        expect(keys).toContain("default_currency");
        // The two that were on this list with nothing writing or reading them.
        expect(keys).not.toContain("currency");
        expect(keys).not.toContain("currency_symbol");
    });

    it("is the same key the checkout charges in", () => {
        const checkout = read("module-sources/store/api/checkout/route.ts");
        expect(checkout).toContain('key: "default_currency"');
    });

    it("is exported from the module SDK, so a module need not guess", () => {
        expect(read("src/core/sdk/ui.ts")).toContain("useSiteCurrency");
        // The addition is what matters, not the number it landed on: the
        // changelog entry has to survive later bumps to stay useful.
        const version = read("src/core/lib/core-version.ts");
        expect(version).toContain("1.8.0 - `useSiteCurrency` joins `@/core/sdk/ui`");
        const [major, minor] = /CORE_API_VERSION = "(\d+)\.(\d+)/.exec(version)!.slice(1).map(Number);
        expect(major * 1000 + minor).toBeGreaterThanOrEqual(1008);
    });

    it("is mounted where every page can reach it", () => {
        const layout = read("src/app/[locale]/layout.tsx");
        expect(layout).toContain("<SiteCurrencyProvider>");
        // Outside the module providers, so a module's own picker can drive it.
        expect(layout.indexOf("<SiteCurrencyProvider>")).toBeLessThan(layout.indexOf("<ModuleContextProviders>"));
    });
});

describe("the providers that were never mounted", () => {
    it("are gone from the store and the leaderboard", () => {
        expect(fs.existsSync(path.join(ROOT, "module-sources/store/lib/currency-context.tsx"))).toBe(false);
        expect(fs.existsSync(path.join(ROOT, "module-sources/leaderboard/lib/currency-context.tsx"))).toBe(false);
    });

    it("left no import behind", () => {
        const offenders = screens()
            .filter((f) => /currency-context/.test(fs.readFileSync(f, "utf8")))
            .map(rel);
        expect(offenders).toEqual([]);
    });

    it("are gone from the currency module, which no longer needs its own", () => {
        expect(fs.existsSync(path.join(ROOT, "module-sources/currency/lib/context.tsx"))).toBe(false);
        const manifest = JSON.parse(read("module-sources/currency/module.json"));
        expect(manifest.contextProviders).toBeUndefined();
    });
});

describe("the footer currency picker", () => {
    const source = read("module-sources/currency/components/CurrencySelector.tsx");

    it("drives the price formatter core owns", () => {
        expect(source).toContain("useSiteCurrency");
        expect(source).toContain("setDisplay");
    });

    it("re-quotes the configured rates against the site's own currency", () => {
        // The config's rates are relative to the config's base, which need not
        // be what this site charges in. Dividing is what stops a price being
        // converted twice.
        expect(source).toContain("target.rate / baseRate");
    });

    it("hides itself rather than offering one option", () => {
        expect(source).toContain("options.length < 2");
    });

    it("keeps an icon beside it, the way the language picker above it has one", () => {
        // The footer's settings column is a row per setting: icon, then
        // dropdown. Taking the dollar sign out of the label once took the icon
        // with it, and left this row shorter than the one above it.
        expect(source).toMatch(/<Coins[^>]*className="w-4 h-4 text-muted-foreground"/);
    });

    it("does not put a currency glyph on a control that offers several", () => {
        // Why the icon is not a dollar sign: it stayed a dollar while the
        // label read EUR or TRY.
        expect(source).not.toContain("DollarSign");
        expect(source).not.toMatch(/[$€₺]/);
    });
});

describe("every module that shows a price", () => {
    it("gets the currency from the SDK, by hook or by server helper", () => {
        const priced = screens().filter((f) => {
            const source = code(fs.readFileSync(f, "utf8"));
            return /\bmoney\(|formatPrice\(/.test(source) && f.includes("module-sources");
        });
        expect(priced.length).toBeGreaterThan(8);
        for (const file of priced) {
            const source = fs.readFileSync(file, "utf8");
            const wired = source.includes("useSiteCurrency") || source.includes("siteCurrency()");
            expect(wired, `${rel(file)} formats money without asking core what the currency is`).toBe(true);
        }
    });

    it("uses the server helper where a hook cannot run", () => {
        // The admin order detail page is a server component. A price it
        // renders is always the base currency: the visitor's display choice
        // lives in their browser, so guessing it here would ship one currency
        // in the HTML and another after hydration.
        const source = read("module-sources/store/pages/admin/orders/[id]/page.tsx");
        expect(source).toContain("siteCurrency()");
        expect(source).not.toContain("useSiteCurrency");
        expect(source).toContain("async function");
    });
});
