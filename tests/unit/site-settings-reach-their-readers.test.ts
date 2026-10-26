import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isWidgetVisible, orderWidgets } from "@/core/lib/homepage-widgets";
import { relativePath } from "./source-text";

/**
 * A setting a page reads is a setting the page can receive.
 *
 * `useSiteSettings` is the only way a client component reads site settings,
 * and it fetches `/api/v1/public-settings`, which publishes a fixed allowlist
 * of keys. A component reading a key that is not on that list gets
 * `undefined` forever: no error, no empty state, just the fallback branch, so
 * the admin screen that writes the key reports "saved" and nothing changes.
 *
 * Three keys were in that state. `widget_visibility` and `widget_order` are
 * written by Admin > Settings > Widgets and read by the homepage, so hiding a
 * widget and reordering the sidebar were both no-ops. `hero_discord_url` is
 * the back-compat alias the footer documents for installs migrated from older
 * versions, and it could never resolve.
 */

const ROOT = process.cwd();
const ALLOWLIST_FILE = path.join(ROOT, "src/app/api/v1/public-settings/route.ts");

/** The keys `/api/v1/public-settings` will answer with. */
export function publicKeys(source: string): Set<string> {
    const block = source.split("const PUBLIC_KEYS")[1]?.split("];")[0] ?? "";
    return new Set([...block.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]));
}

/** Every `settings.foo` / `settings["foo"]` read in a file, with its path. */
export function settingsRead(source: string): string[] {
    const keys = new Set<string>();
    for (const m of source.matchAll(/settings\??\.([a-z_][a-z_0-9]*)|settings\[\s*["']([a-z_0-9]+)["']/g)) {
        keys.add(m[1] ?? m[2]);
    }
    return [...keys];
}

/** Files anywhere in the tree that consume `useSiteSettings`. */
function consumers(): { file: string; source: string }[] {
    const out: { file: string; source: string }[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules" && entry.name !== "generated") walk(full);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name)) continue;
            const source = fs.readFileSync(full, "utf8");
            if (source.includes("useSiteSettings")) out.push({ file: relativePath(ROOT, full), source });
        }
    };
    for (const base of ["src", "module-sources"]) walk(path.join(ROOT, base));
    return out;
}

describe("keys read through useSiteSettings", () => {
    const allowed = publicKeys(fs.readFileSync(ALLOWLIST_FILE, "utf8"));

    it("finds the allowlist", () => {
        expect(allowed.size).toBeGreaterThan(10);
        expect(allowed.has("site_name")).toBe(true);
    });

    it("finds the components that read them", () => {
        const files = consumers().map((c) => c.file);
        expect(files).toContain("src/core/hooks/useFooter.ts");
        expect(files.length).toBeGreaterThan(1);
    });

    it("are all published by /api/v1/public-settings", () => {
        const unreachable: string[] = [];
        for (const { file, source } of consumers()) {
            // The hook's own module and the admin screen that writes a key
            // both mention `settings.` without reading the public payload.
            if (file.endsWith("useSiteSettings.ts")) continue;
            for (const key of settingsRead(source)) {
                if (!allowed.has(key)) unreachable.push(`${file}: ${key}`);
            }
        }
        expect(unreachable).toEqual([]);
    });

    it("includes the key that was unreachable", () => {
        expect(allowed.has("hero_discord_url")).toBe(true);
    });

    it("keeps the widget settings to the server, where the homepage now reads them", () => {
        // They were published for a homepage that read them in the browser.
        // `loadHomeLayout` reads them on the server, the admin screen reads
        // them through the admin API, and nothing else needs a visitor to
        // receive how the sidebar was arranged.
        for (const key of ["widget_visibility", "widget_order"]) {
            expect(allowed.has(key), key).toBe(false);
        }
    });

    it("reads keys out of a file the way the scanner claims", () => {
        expect(settingsRead('const a = settings.site_name; const b = settings["widget_order"];').sort())
            .toEqual(["site_name", "widget_order"]);
        expect(settingsRead("const a = settings?.footer_copyright;")).toEqual(["footer_copyright"]);
    });
});

describe("homepage widget preferences", () => {
    const w = (id: string, defaultVisible = true) => ({ id, defaultVisible });

    it("falls back to the manifest's defaultVisible", () => {
        expect(isWidgetVisible(w("A"), {})).toBe(true);
        expect(isWidgetVisible(w("B", false), {})).toBe(false);
        expect(isWidgetVisible(w("B", false), undefined)).toBe(false);
    });

    it("lets a saved preference win over the default either way", () => {
        expect(isWidgetVisible(w("A"), { A: false })).toBe(false);
        expect(isWidgetVisible(w("B", false), { B: true })).toBe(true);
    });

    it("ignores a saved value that is not a boolean", () => {
        expect(isWidgetVisible(w("A"), { A: "no" })).toBe(true);
        expect(isWidgetVisible(w("B", false), { B: 1 })).toBe(false);
    });

    it("orders by the saved order", () => {
        const widgets = [w("A"), w("B"), w("C")];
        expect(orderWidgets(widgets, ["C", "A", "B"]).map((x) => x.id)).toEqual(["C", "A", "B"]);
    });

    it("keeps declared order when nothing is saved", () => {
        const widgets = [w("A"), w("B"), w("C")];
        for (const saved of [undefined, null, [], "nonsense", {}]) {
            expect(orderWidgets(widgets, saved).map((x) => x.id)).toEqual(["A", "B", "C"]);
        }
    });

    it("puts a widget the saved order never named after the ones it did", () => {
        const widgets = [w("New"), w("A"), w("B")];
        expect(orderWidgets(widgets, ["B", "A"]).map((x) => x.id)).toEqual(["B", "A", "New"]);
    });

    it("survives a saved order naming widgets that are gone, or naming one twice", () => {
        const widgets = [w("A"), w("B")];
        expect(orderWidgets(widgets, ["Uninstalled", "B", "B", "A"]).map((x) => x.id)).toEqual(["B", "A"]);
    });
});
