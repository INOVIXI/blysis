import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A string in the catalogue is a string some screen says.
 *
 * `messages-core` had grown a hundred and thirty-five keys nothing reads. A
 * whole feature's worth of them belonged to the per-admin dashboard
 * customizer, which was removed; another group named the previous and next
 * buttons that eight screens wrote by hand before there was one `Pagination`;
 * the rest were `*_cancel` beside `common.cancel`, marketplace review strings
 * for a feature that was never built, and backup dialogs from a screen that
 * has since been rewritten.
 *
 * Dead strings are not free. Every one is translated, reviewed, and seeded
 * into the Translation table on every boot, and each is a plausible answer to
 * "is this already translated?" that turns out to lead nowhere.
 *
 * Some keys are assembled at the call site rather than written out, and those
 * cannot be found by searching for them. Rather than exempt a prefix - which
 * is how `crumb_customizer` outlived its route by three releases - each one
 * below has to resolve against something real: a breadcrumb against a route
 * that exists, everything else against a value that appears in the source.
 */

const ROOT = path.resolve(__dirname, "../..");
const SEARCH = ["src", "module-sources", "scripts", "tests", "docs"];
const EXTENSIONS = [".ts", ".tsx", ".json", ".md"];

function walk(dir: string, onFile: (full: string, name: string) => void, onDir?: (name: string) => void): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules") continue;
            onDir?.(entry.name);
            walk(full, onFile, onDir);
        } else {
            onFile(full, entry.name);
        }
    }
}

const files: string[] = [];
for (const dir of SEARCH) {
    walk(path.join(ROOT, dir), (full, name) => {
        // This file names dead keys in its own prose. Reading itself would
        // keep every one of them alive, which is the opposite of the point.
        if (full === __filename) return;
        if (EXTENSIONS.some((e) => name.endsWith(e))) files.push(full);
    });
}
const BLOB = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");

/**
 * Every slug a breadcrumb can be built from: a directory under `src/app` or a
 * module's `pages`, a module id (a module mounts its admin screen at
 * /admin/<id>), and a theme's setting groups (/admin/theme/<group>).
 */
function breadcrumbSlugs(): Set<string> {
    const slugs = new Set<string>();
    walk(path.join(ROOT, "src/app"), () => {}, (name) => slugs.add(name));
    for (const moduleId of fs.readdirSync(path.join(ROOT, "module-sources"))) {
        slugs.add(moduleId);
        walk(path.join(ROOT, "module-sources", moduleId, "pages"), () => {}, (name) => slugs.add(name));
    }
    for (const theme of fs.readdirSync(path.join(ROOT, "src/themes"))) {
        const manifest = path.join(ROOT, "src/themes", theme, "theme.json");
        if (!fs.existsSync(manifest)) continue;
        const settings = JSON.parse(fs.readFileSync(manifest, "utf8")).settings ?? {};
        for (const group of Object.keys(settings)) slugs.add(group);
    }
    return slugs;
}

const SLUGS = breadcrumbSlugs();

/**
 * A key nothing writes out in full, and the proof it is still reachable.
 * `built` is the template literal that assembles it; `resolves` decides
 * whether this particular key is one the template can still produce.
 */
const CONSTRUCTED: { match: RegExp; built: string; resolves: (suffix: string) => boolean }[] = [
    // AdminBreadcrumb: `crumb_${slug}` for a route with no sidebar entry.
    { match: /^crumb_(.+)$/, built: "`crumb_${slug}`", resolves: (s) => SLUGS.has(s) },
    // NotificationPrefsTab: one row per channel a notification can take.
    { match: /^channel_(.+)$/, built: "`channel_${c}`", resolves: (s) => BLOB.includes(s) },
    // The alerting screen, over a health status.
    { match: /^health_(.+)$/, built: "`health_${status}`", resolves: (s) => BLOB.includes(s) },
    { match: /^alerting_(.+)Hint$/, built: "`alerting_${status}Hint`", resolves: (s) => BLOB.includes(s) },
    // The block merger, over the category a module's page block declares.
    { match: /^blocks_cat_(.+)$/, built: "`blocks_cat_${cat}`", resolves: (s) => BLOB.includes(s) },
    // buildNavGroups, over a section several modules share in one group. The
    // proof is a manifest that puts an entry there: core ships the heading,
    // modules decide whether anything stands under it.
    {
        match: /^navSection_(.+)$/,
        built: "`navSection_${entry.section}`",
        // A section core ships carries its own heading, so a key of this shape
        // beside one is never looked up however many manifests name it.
        resolves: (s) => BLOB.includes(`"section": "${s}"`) && !BLOB.includes(`id: "${s}",\n                header:`),
    },
];

function catalogue(locale: string): [string, string][] {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8"));
    const out: [string, string][] = [];
    for (const [namespace, value] of Object.entries(json)) {
        if (typeof value !== "object" || value === null) continue;
        for (const key of Object.keys(value as Record<string, unknown>)) out.push([namespace, key]);
    }
    return out;
}

function reached(key: string): boolean {
    if (BLOB.includes(key)) return true;
    return CONSTRUCTED.some((rule) => {
        const hit = rule.match.exec(key);
        return hit !== null && rule.resolves(hit[1]);
    });
}

describe("the core message catalogue", () => {
    const keys = catalogue("en");

    it("finds the catalogue and the sources", () => {
        expect(keys.length).toBeGreaterThan(1000);
        expect(BLOB.length).toBeGreaterThan(1_000_000);
        expect(SLUGS.size).toBeGreaterThan(50);
    });

    it("says every string it carries", () => {
        const dead = keys.filter(([, key]) => !reached(key)).map(([n, k]) => `${n}.${k}`);
        expect(dead).toEqual([]);
    });

    it("carries the same keys in every locale", () => {
        const en = new Set(catalogue("en").map(([n, k]) => `${n}.${k}`));
        const tr = new Set(catalogue("tr").map(([n, k]) => `${n}.${k}`));
        expect([...en].filter((k) => !tr.has(k))).toEqual([]);
        expect([...tr].filter((k) => !en.has(k))).toEqual([]);
    });

    it("claims a key is assembled only where one is assembled", () => {
        const unbuilt = CONSTRUCTED.filter((rule) => !BLOB.includes(rule.built)).map((rule) => rule.built);
        expect(unbuilt).toEqual([]);
    });

    it("says every error code it carries a message for", () => {
        // These are not reached by name: `errorMessage` builds the key from
        // the `code` an endpoint answered with, so the proof that a string is
        // asked for is the code appearing in a handler. They live one level
        // down, in an `err` object per namespace, which is why the walk above
        // does not see them.
        const json = JSON.parse(fs.readFileSync(path.join(ROOT, "messages-core/en.json"), "utf8"));
        expect(BLOB).toContain("`err.${code}`");

        const dead: string[] = [];
        let checked = 0;
        for (const [namespace, value] of Object.entries(json)) {
            const codes = (value as Record<string, unknown>)?.err;
            if (!codes || typeof codes !== "object") continue;
            for (const code of Object.keys(codes as Record<string, unknown>)) {
                checked += 1;
                if (!BLOB.includes(`"${code}"`) && !BLOB.includes(`'${code}'`)) dead.push(`${namespace}.err.${code}`);
            }
        }
        expect(checked).toBeGreaterThan(10);
        expect(dead).toEqual([]);
    });

    it("keeps no rule for a shape the catalogue no longer has", () => {
        // A rule matching nothing is itself the dead entry.
        const idle = CONSTRUCTED
            .filter((rule) => !keys.some(([, key]) => rule.match.test(key)))
            .map((rule) => rule.built);
        expect(idle).toEqual([]);
    });
});
