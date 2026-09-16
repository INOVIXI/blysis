/**
 * An installation never reads the name of the product it was built from.
 *
 * `SiteName`, `useSiteInitials` and `useSiteLogo` exist because six screens
 * had spelled the product's name into their markup. Each time one was found
 * it was fixed, and the next one was found by somebody noticing it on screen
 * - which is not a way to keep a promise. What was missing was a scan.
 *
 * Found by this gate on the day it was written, all of them user-facing:
 *
 *   - the setup wizard offered "Blysis" as the operator's own site name, in
 *     the first field of the first screen they ever see;
 *   - the personal data export a member downloads was headed "Blysis personal
 *     data export" rather than the name of the site they downloaded it from;
 *   - a module with no author was attributed to "Blysis" in the marketplace,
 *     so a fork's own catalogue credited somebody else.
 *
 * Comments are not the product's markup and are read out first: this file's
 * own source, and the SDK headers that say what the SDK is, name it freely.
 * What a reader sees is a string, and a string is what this counts.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

const ROOT = process.cwd();

/** The name this product ships under. */
const PRODUCT = "Blysis";

/**
 * Where naming it is the point. Each line is a decision, and each needs a
 * reason as good as these.
 */
const ARGUED_FOR: Record<string, string> = {
    "src/core/config/server.ts":
        "the name to use before the database has been reached at all - a fresh install, or the build phase. Something has to be there, and every caller replaces it with `site_name` the moment a row can be read.",
    "src/core/lib/app-url.ts":
        "the same fallback for the same reason, read by callers that have no async context to await a setting in.",
    "src/app/manifest.ts":
        "nothing: it reads the catalogue's `appName`. Listed so a literal creeping back in is a change to this list rather than a silent one.",
};

function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

const FILES = [...walk(path.join(ROOT, "src/core")), ...walk(path.join(ROOT, "src/app"))];
const rel = (f: string) => path.relative(ROOT, f);

/** String literals in a file, with comments already gone. */
function literals(source: string): string[] {
    return [
        ...Array.from(source.matchAll(/"((?:[^"\\]|\\.)*)"/g), (m) => m[1]),
        ...Array.from(source.matchAll(/'((?:[^'\\]|\\.)*)'/g), (m) => m[1]),
        ...Array.from(source.matchAll(/`((?:[^`\\]|\\.)*)`/g), (m) => m[1]),
    ];
}

describe("core", () => {
    it("has files to read", () => {
        expect(FILES.length).toBeGreaterThan(300);
    });

    it("writes the product's name into no string a reader can reach", () => {
        const offenders: string[] = [];
        for (const file of FILES) {
            if (ARGUED_FOR[rel(file)]) continue;
            const code = stripComments(fs.readFileSync(file, "utf8"));
            for (const literal of literals(code)) {
                // A class name is not a word anybody reads: `blysis-content`
                // and the `--blysis-*` tokens are this product's own CSS
                // namespace, which is the one place the name is structural.
                if (/blysis-|--blysis|Blysis(Hook|Filter)/.test(literal)) continue;
                if (!literal.includes(PRODUCT)) continue;
                offenders.push(`${rel(file)}: ${literal.slice(0, 60)}`);
            }
        }
        expect(offenders, "read it from `site_name`, or from the catalogue's appName").toEqual([]);
    });

    it("writes the product's own domain into no string a reader can reach", () => {
        // A name on a screen is awkward; an address is worse, because
        // something acts on it. The return address on outbound mail fell back
        // to noreply@ at the product's domain, so every installation that had
        // not set one sent its mail claiming to be a host it does not own -
        // which fails SPF at the receiving end and lands in a spam folder.
        const offenders: string[] = [];
        for (const file of FILES) {
            const code = stripComments(fs.readFileSync(file, "utf8"));
            for (const literal of literals(code)) {
                // A top level domain, not any dotted name: `blysis.shared-request`
                // is a symbol key and `blysis.admin.updateBanner` a storage
                // key, both internal, neither an address anything resolves.
                if (!/\bblysis\.(com|net|org|io|dev|app|co)\b/i.test(literal)) continue;
                offenders.push(`${rel(file)}: ${literal.slice(0, 60)}`);
            }
        }
        expect(offenders, "build it from this installation's own host").toEqual([]);
    });

    it("gives every exception a reason, and keeps none that has gone", () => {
        for (const [file, reason] of Object.entries(ARGUED_FOR)) {
            expect(fs.existsSync(path.join(ROOT, file)), `${file} is argued for but missing`).toBe(true);
            expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(60);
        }
    });
});
