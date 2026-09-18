import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

/**
 * No component formats a date in whatever zone the machine happens to be in.
 *
 * `toLocaleDateString(tag)` looks careful - the language is pinned, which is
 * what the tag is for - and leaves the zone to the process. On the server that
 * is the host's and in the browser it is the visitor's, so a timestamp near
 * midnight is the 10th in the HTML and the 11th a moment later. React finds
 * the text it drew does not match the text it was given, throws that subtree
 * away and rebuilds it on the client, and logs a hydration error. The
 * punishments list did exactly that, on every load, for eight months.
 *
 * Twenty-nine screens shared the mistake because they shared the idiom, which
 * is why this reads the source rather than trusting anyone to remember:
 * `useLocalDate` and `useLocalDateTime` name the site's zone, the one the
 * request config declares and next-intl carries to the client, so both sides
 * of a render name the same one.
 *
 * Numbers are untouched. `count.toLocaleString(tag)` groups thousands and has
 * no zone in it.
 */

const ROOT = join(__dirname, "../..");

/** The formatter is allowed to call the platform. It is the one that pins the zone. */
const ALLOWED = [
    "src/core/lib/format-date.ts",
    "src/core/hooks/useLocalDate.ts",
];

/** A date reaching `toLocale*`, rather than a number. */
const DATE_FORMAT = /(new Date\([^)]*\)|[A-Za-z_$][\w$]*(?:At|Date|date|Time)\b)\s*\??\.toLocale(?:Date|Time)?String\(/;

function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
    }
    return out;
}

describe("a date is formatted in the site's zone", () => {
    const offenders = [
        ...walk(join(ROOT, "src/core/components")),
        ...walk(join(ROOT, "src/app")),
        ...walk(join(ROOT, "module-sources")),
    ]
        .map((file) => file.slice(ROOT.length + 1))
        .filter((path) => !ALLOWED.includes(path))
        .filter((path) => DATE_FORMAT.test(readFileSync(join(ROOT, path), "utf-8")));

    it("is what every screen holding a date does", () => {
        expect(offenders).toEqual([]);
    });

    it("comes from the request config, or the client has nothing to agree with", () => {
        const config = readFileSync(join(ROOT, "src/core/lib/i18n/request.ts"), "utf-8");

        // next-intl carries this to the provider. Without it the hook has no
        // zone to name and the whole rule is decoration.
        expect(config).toContain("timeZone");
        expect(config).toContain("siteTimeZone");
    });

    it("leaves a number alone, because grouping thousands has no zone in it", () => {
        expect(DATE_FORMAT.test("credits.toLocaleString(numberTag)")).toBe(false);
        expect(DATE_FORMAT.test("new Date(x).toLocaleDateString(tag)")).toBe(true);
        expect(DATE_FORMAT.test("row.createdAt.toLocaleString(tag)")).toBe(true);
    });
});
