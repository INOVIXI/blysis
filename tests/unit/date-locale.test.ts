/**
 * A date formatted in a locale the reader did not pick.
 *
 * Twenty-two screens passed a literal `"tr-TR"` to `toLocaleString`, so an
 * English admin read Turkish-formatted timestamps on the cron page, the
 * email queue, the audit log, the backup list and eighteen more. Thirty-one
 * other files hand-rolled `locale === "tr" ? "tr-TR" : locale` to avoid
 * exactly that, which is the same decision made thirty-one times. Ten more
 * called the shared `formatDate()` without its locale argument, so its
 * `"en-US"` default rendered English dates on the public blog and the store
 * order screens no matter who was reading.
 *
 * The mapping lives in `dateLocaleTag()` (src/core/lib/utils.ts, re-exported
 * from the module SDK) and this gate keeps it there: no BCP 47 tag written
 * inline at a call site, and no second copy of the mapping.
 *
 * A literal tag is still fine in a test, a seed, or a script - those pick a
 * locale deliberately rather than inheriting the reader's.
 *
 * The locale was only half of it, and the other half cost a hydration error on
 * every page holding a date: a tag pins the language and leaves the zone to
 * the machine. `a-date-is-formatted-in-the-sites-zone.test.ts` holds that half,
 * and between them a screen now takes both from `useLocalDate` rather than
 * passing either.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "../..");
const SCANNED = ["src/app", "src/core", "module-sources"];

/**
 * The helper's own home, plus the hook that wraps it - and two files that
 * format nothing anybody reads.
 *
 * `site-time.ts` asks `Intl` what the wall clock says in a named zone, and
 * parses the answer. The tag there is a parsing device, not a rendering
 * choice: it is picked precisely because "en-US" gives fixed, ASCII day names
 * and a 24-hour option, and its output never reaches a page. Handing it the
 * reader's locale would break the parse in any locale that spells Friday
 * differently, which is all of them.
 *
 * `turkish-date.ts` is the same kind of thing at a module's boundary. An
 * accounting integrator specifies `dd.MM.yyyy HH:mm:ss` on the wire in both
 * directions, so the shape is the other system's and not the reader's: a
 * date rendered in the visitor's locale there is a request that system
 * rejects, or worse, misreads.
 */
const HELPER_FILES = [
    "src/core/lib/utils.ts",
    "src/core/lib/site-time.ts",
    "module-sources/birfatura-invoicing/lib/turkish-date.ts",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === "node_modules" || entry === "generated") continue;
            sourceFiles(full, out);
        } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
    }
    return out;
}

function scanned(): { rel: string; source: string }[] {
    const files: { rel: string; source: string }[] = [];
    for (const dir of SCANNED) {
        for (const full of sourceFiles(join(ROOT, dir))) {
            const rel = relative(ROOT, full).replace(/\\/g, "/");
            if (HELPER_FILES.includes(rel)) continue;
            files.push({ rel, source: readFileSync(full, "utf-8") });
        }
    }
    return files;
}

/** `toLocaleString("tr-TR")`, `toLocaleDateString('en-US', ...)` and friends. */
const LITERAL_TAG_CALL = /\.toLocale(?:Date|Time)?String\(\s*["'][a-z]{2}(?:-[A-Za-z]{2,4})?["']/g;

/**
 * `new Intl.DateTimeFormat("tr-TR")` and the relative-time formatter.
 *
 * `Intl.NumberFormat` is deliberately not covered: the currency module pins
 * `en-US` so a price renders the same way whatever language the page is in,
 * which is a currency decision rather than a date one.
 */
const LITERAL_TAG_INTL = /new Intl\.(?:DateTimeFormat|RelativeTimeFormat)\(\s*["'][a-z]{2}(?:-[A-Za-z]{2,4})?["']/g;

/** A second copy of the mapping: `locale === "tr" ? "tr-TR" : locale`. */
const HAND_ROLLED_MAP = /===\s*["'][a-z]{2}["']\s*\?\s*["'][a-z]{2}-[A-Za-z]{2,4}["']/g;

/** `formatDate(x)` / `formatDate(x, opts)` - no locale, so the "en-US" default wins. */
const FORMAT_DATE_CALL = /\bformatDate\(/g;

describe("date formatting uses the reader's locale", () => {
    it("passes no literal BCP 47 tag to a toLocale* call", () => {
        const offenders: string[] = [];
        for (const { rel, source } of scanned()) {
            for (const m of source.matchAll(LITERAL_TAG_CALL)) offenders.push(`${rel}: ${m[0]}`);
        }
        expect(offenders, `Use dateLocaleTag(locale) instead:\n${offenders.join("\n")}`).toEqual([]);
    });

    it("passes no literal BCP 47 tag to an Intl constructor", () => {
        const offenders: string[] = [];
        for (const { rel, source } of scanned()) {
            for (const m of source.matchAll(LITERAL_TAG_INTL)) offenders.push(`${rel}: ${m[0]}`);
        }
        expect(offenders, `Use dateLocaleTag(locale) instead:\n${offenders.join("\n")}`).toEqual([]);
    });

    it("keeps the locale-to-tag mapping in one place", () => {
        const offenders: string[] = [];
        for (const { rel, source } of scanned()) {
            for (const m of source.matchAll(HAND_ROLLED_MAP)) offenders.push(`${rel}: ${m[0]}`);
        }
        expect(
            offenders,
            `dateLocaleTag() in src/core/lib/utils.ts already does this:\n${offenders.join("\n")}`,
        ).toEqual([]);
    });

    it("gives the shared formatDate() a locale at every call site", () => {
        const offenders: string[] = [];
        for (const { rel, source } of scanned()) {
            // A file with its own `formatDate` is not calling the shared one.
            // Most now bind it from `useLocalDate`, which carries the reader's
            // locale and the site's zone without an argument - see
            // `a-date-is-formatted-in-the-sites-zone.test.ts`.
            if (/export function formatDate|function formatDate\(|const formatDate\s*=/.test(source)) continue;
            for (const m of source.matchAll(FORMAT_DATE_CALL)) {
                // Read the argument list, tracking nesting, and count top-level commas.
                let depth = 1;
                let commas = 0;
                let i = m.index! + m[0].length;
                for (; i < source.length && depth > 0; i++) {
                    const c = source[i];
                    if (c === "(" || c === "[" || c === "{") depth++;
                    else if (c === ")" || c === "]" || c === "}") depth--;
                    else if (c === "," && depth === 1) commas++;
                }
                if (commas < 2) {
                    offenders.push(`${rel}: ${source.slice(m.index!, i).replace(/\s+/g, " ")}`);
                }
            }
        }
        expect(
            offenders,
            `Pass dateLocaleTag(locale) as the third argument:\n${offenders.join("\n")}`,
        ).toEqual([]);
    });

    it("imports dateLocaleTag wherever it is called", () => {
        const offenders: string[] = [];
        for (const { rel, source } of scanned()) {
            if (!/\bdateLocaleTag\(/.test(source)) continue;
            if (!/import \{[^}]*\bdateLocaleTag\b[^}]*\} from/.test(source)) offenders.push(rel);
        }
        expect(offenders, `Missing import:\n${offenders.join("\n")}`).toEqual([]);
    });

    it("has modules import the helper through the SDK, never from core internals", () => {
        const offenders: string[] = [];
        for (const { rel, source } of scanned()) {
            if (!rel.startsWith("module-sources/")) continue;
            const m = source.match(/import \{[^}]*\bdateLocaleTag\b[^}]*\} from ["']([^"']+)["']/);
            if (m && !m[1].startsWith("@/core/sdk")) offenders.push(`${rel}: ${m[1]}`);
        }
        expect(offenders, `Import from "@/core/sdk":\n${offenders.join("\n")}`).toEqual([]);
    });
});

describe("dateLocaleTag", () => {
    it("maps the locales core ships and leaves anything else alone", async () => {
        const { dateLocaleTag } = await import("@/core/lib/utils");
        expect(dateLocaleTag("en")).toBe("en-US");
        expect(dateLocaleTag("tr")).toBe("tr-TR");
        expect(dateLocaleTag("de")).toBe("de");
        expect(dateLocaleTag("")).toBe("");
    });
});
