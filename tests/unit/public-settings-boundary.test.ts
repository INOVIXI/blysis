import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripComments } from "./source-text";

const root = path.resolve(import.meta.dirname, "../..");
const routeSource = fs.readFileSync(
    path.join(root, "src/app/api/v1/public-settings/route.ts"),
    "utf8",
);

/**
 * A setting an admin can type in, that nothing can ever read back.
 *
 * `/api/v1/public-settings` serves an allow-list, `PUBLIC_KEYS`, and its own
 * comment says module settings belong in the module's own public API. Two
 * modules read straight from it anyway, for keys the allow-list has never
 * carried: the Google Analytics component looked up `google_analytics_id`, and
 * the store's purchase toast looked up `live_purchase_toast`. Both got
 * `undefined` on every page load, so an admin could fill the field in, see it
 * saved, and get nothing - no tracking script, no toast, and no sign that the
 * value went nowhere.
 *
 * The failure is silent by construction: an absent key on a JSON object is not
 * an error. So it is caught here instead.
 */

function publicKeys(): string[] {
    const block = routeSource.slice(
        routeSource.indexOf("const PUBLIC_KEYS"),
        routeSource.indexOf("const PUBLIC_SETTINGS_CACHE_KEY"),
    );
    return [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
}

/**
 * Source with comments removed.
 *
 * Every rule below is about what the code does, and each of these files
 * explains in prose the mistake it no longer makes. Matching raw text would
 * fail them for describing the bug they fix.
 */
function code(source: string): string {
    return stripComments(source);
}

/** Every key a file pulls off the public-settings payload. */
function keysRead(source: string): string[] {
    return [
        ...source.matchAll(/settings\?\.([a-z][A-Za-z0-9_]*)/g),
        ...source.matchAll(/settings\[["']([a-z][A-Za-z0-9_]*)["']\]/g),
    ].map((m) => m[1]);
}

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === ".next") continue;
            out.push(...sourceFiles(p));
        } else if (/\.tsx?$/.test(entry.name)) {
            out.push(p);
        }
    }
    return out;
}

describe("the public settings allow-list", () => {
    const keys = publicKeys();

    it("parses", () => {
        expect(keys).toContain("site_name");
        expect(keys.length).toBeGreaterThan(10);
    });

    it("is the only source of keys core reads from it", () => {
        const unpublished: string[] = [];
        for (const file of sourceFiles(path.join(root, "src"))) {
            // src/modules holds installed copies of module-sources, checked
            // below as modules rather than twice as core.
            if (file.includes(`${path.sep}src${path.sep}modules${path.sep}`)) continue;
            const source = code(fs.readFileSync(file, "utf8"));
            if (!source.includes("/api/v1/public-settings")) continue;
            for (const key of keysRead(source)) {
                // Envelope fields, not settings.
                if (key === "cacheSeconds" || key === "isDemo") continue;
                if (!keys.includes(key)) {
                    unpublished.push(`${path.relative(root, file)}: ${key}`);
                }
            }
        }
        expect(unpublished).toEqual([]);
    });
});

describe("a module", () => {
    const moduleFiles = fs
        .readdirSync(path.join(root, "module-sources"), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .flatMap((e) => sourceFiles(path.join(root, "module-sources", e.name)));

    it("has files to check", () => {
        expect(moduleFiles.length).toBeGreaterThan(100);
    });

    it("does not read core's public settings", () => {
        // A module's public values go through the module's own API entry, so
        // that adding one is a change to the module and not to core.
        const trespassers = moduleFiles
            .filter((f) => code(fs.readFileSync(f, "utf8")).includes("/api/v1/public-settings"))
            .map((f) => path.relative(root, f));
        expect(trespassers).toEqual([]);
    });
});

describe("the google analytics module", () => {
    const dir = path.join(root, "module-sources/google-analytics");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"));

    it("serves its own measurement ID", () => {
        const entry = (manifest.api ?? []).find(
            (a: { path: string }) => a.path === "/google-analytics/config",
        );
        expect(entry).toBeDefined();
        expect(entry.method).toBe("GET");
        expect(fs.existsSync(path.join(dir, entry.handler))).toBe(true);
    });

    it("reads the ID from that endpoint, not from a build-time variable", () => {
        const component = code(fs.readFileSync(path.join(dir, "components/GoogleAnalytics.tsx"), "utf8"));
        expect(component).toContain("/api/v1/google-analytics/config");
        // NEXT_PUBLIC_ is frozen into the bundle at build time, so an install
        // running the prebuilt image can never set one.
        expect(component).not.toContain("NEXT_PUBLIC_");
    });

    it("does not interpolate the ID into an inline script unescaped", () => {
        const component = code(fs.readFileSync(path.join(dir, "components/GoogleAnalytics.tsx"), "utf8"));
        expect(component).not.toContain("gtag('config', '${gaId}')");
        expect(component).toContain("JSON.stringify(gaId)");
    });
});
