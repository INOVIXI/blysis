import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveRouteTitle, titleFromMessages, humanizeSegment } from "@/core/lib/route-title";

/**
 * The browser tab and the search result, in the language the page is in.
 *
 * A module page is a component in a registry, not a route segment file, so it
 * cannot export `generateMetadata`; core's catch-all titles it. Core built
 * that title by humanizing the last literal segment of the route pattern, and
 * a route pattern is a URL: written once, in English, by the module author.
 *
 * Measured on the demo, every module page in Turkish:
 *
 *   /tr/store        <h1>Mağaza</h1>            <title>Store | Blysis</title>
 *   /tr/store/cart   <h1>Alışveriş Sepeti</h1>  <title>Cart | Blysis</title>
 *   /tr/punishments  <h1>Cezalar</h1>           <title>Punishments | Blysis</title>
 *   /tr/leaderboard  <h1>Sıralama</h1>          <title>Leaderboard | Blysis</title>
 *   /tr/vote         <h1>Oy Ver, Ödül Kazan</h1><title>Vote | Blysis</title>
 *
 * The tab is what a visitor reads with twenty of them open, and the title is
 * the line a search engine prints, so the one string a Turkish visitor was
 * most likely to see out of context was the only one still in English.
 *
 * `/store/vip` was worse: humanizing "vip" gives "Vip", which is a word in
 * neither language.
 *
 * A route now declares `titleKey` into the translations the module already
 * ships. The humanized segment stays as the fallback, so a module that
 * declares nothing behaves exactly as before.
 */

const ROOT = process.cwd();

const messages = {
    pageTitles: { store: "Mağaza", cart: "Sepet", vip: "VIP", blank: "   " },
    store: { nested: { deep: "Derin" } },
    notAString: { here: 42 },
};

describe("titleFromMessages", () => {
    it("resolves a dotted key", () => {
        expect(titleFromMessages(messages, "pageTitles.store")).toBe("Mağaza");
        expect(titleFromMessages(messages, "store.nested.deep")).toBe("Derin");
    });

    it("answers null for anything it cannot use", () => {
        // Null, not the key: a tab reading "pageTitles.store" is worse than
        // one reading "Store".
        expect(titleFromMessages(messages, "pageTitles.missing")).toBeNull();
        expect(titleFromMessages(messages, "nope.nope")).toBeNull();
        expect(titleFromMessages(messages, "notAString.here")).toBeNull();
        expect(titleFromMessages(messages, "pageTitles.blank")).toBeNull();
        expect(titleFromMessages(messages, "pageTitles")).toBeNull();
        expect(titleFromMessages(null, "pageTitles.store")).toBeNull();
        expect(titleFromMessages(messages, undefined)).toBeNull();
    });

    it("refuses a title too long to be one", () => {
        const long = { a: { b: "x".repeat(200) } };
        expect(titleFromMessages(long, "a.b")).toBeNull();
    });
});

describe("resolveRouteTitle", () => {
    it("uses the module's own word for the page", () => {
        expect(resolveRouteTitle({ slug: ["store"], routePattern: "/store", titleKey: "pageTitles.store", messages }))
            .toBe("Mağaza");
    });

    it("falls back to the route pattern when the key does not resolve", () => {
        // An uninstalled locale, a typo, a module that ships no such key: the
        // page still gets a name.
        expect(resolveRouteTitle({ slug: ["store"], routePattern: "/store", titleKey: "pageTitles.nope", messages }))
            .toBe("Store");
        expect(resolveRouteTitle({ slug: ["store"], routePattern: "/store", messages: null }))
            .toBe("Store");
    });

    it("keeps the URL out of the title unless the route earned it", () => {
        // The reason moduleRouteTitle exists: a 200 page that renders "not
        // found" in the browser would otherwise let any visitor mint a title.
        expect(resolveRouteTitle({ slug: ["store", "product", "free-nitro"], routePattern: "/store/product/[...params]", messages }))
            .toBe("Product");
        expect(resolveRouteTitle({ slug: ["blog", "free-nitro"], routePattern: "/blog/[...params]", titleFromPath: true }))
            .toBe("Free Nitro");
    });

    it("lets a resource name itself even when the route declares a key", () => {
        // titleFromPath means the URL identifies the resource, which is more
        // specific than any static page name.
        expect(resolveRouteTitle({
            slug: ["blog", "hello-world"],
            routePattern: "/blog/[...params]",
            titleFromPath: true,
            titleKey: "pageTitles.blog",
            messages,
        })).toBe("Hello World");
    });

    it("still answers for a route it knows nothing about", () => {
        expect(resolveRouteTitle({})).toBe("Page");
        expect(humanizeSegment("order-success")).toBe("Order Success");
    });
});

describe("the catch-all", () => {
    const page = fs.readFileSync(path.join(ROOT, "src/app/[locale]/[...slug]/page.tsx"), "utf8");

    it("resolves the title in the visitor's locale", () => {
        expect(page).toContain("resolveRouteTitle({");
        expect(page).toContain("getMessages(locale)");
        // The old call built the title with no locale in sight.
        expect(page).not.toMatch(/title:\s*moduleRouteTitle\(/);
    });

    it("does not load a catalogue for a route that declared nothing", () => {
        // Every unmatched URL on the site reaches this, and most of them are
        // about to 404. A route that declared a name or a description needs
        // the catalogue; one that declared neither is titled from its own path
        // and never reads a word.
        expect(page).toContain("const declared = Boolean(route?.titleKey || route?.descriptionKey);");
        expect(page).toContain("declared ? await getMessages(locale)");
    });

    it("titles the page even when the catalogue cannot be read", () => {
        expect(page).toContain("catch(() => null)");
    });
});

describe("every module page", () => {
    interface Route { path: string; titleKey?: string; titleFromPath?: boolean }
    const modules = fs
        .readdirSync(path.join(ROOT, "module-sources"), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((id) => fs.existsSync(path.join(ROOT, "module-sources", id, "module.json")))
        .map((id) => ({
            id,
            manifest: JSON.parse(fs.readFileSync(path.join(ROOT, "module-sources", id, "module.json"), "utf8")) as {
                routes?: Route[];
                translations?: Record<string, Record<string, Record<string, string>>>;
            },
        }));

    it("is there to check", () => {
        const routes = modules.flatMap((m) => m.manifest.routes ?? []);
        expect(routes.length).toBeGreaterThan(25);
        expect(routes.filter((r) => r.titleKey).length).toBeGreaterThan(25);
    });

    it("declares a name, or names itself from a URL it vouched for", () => {
        const unnamed: string[] = [];
        for (const { id, manifest } of modules) {
            for (const route of manifest.routes ?? []) {
                if (route.titleKey || route.titleFromPath) continue;
                unnamed.push(`${id}: ${route.path}`);
            }
        }
        expect(unnamed).toEqual([]);
    });

    it("ships that name in every locale it ships", () => {
        const missing: string[] = [];
        for (const { id, manifest } of modules) {
            for (const route of manifest.routes ?? []) {
                if (!route.titleKey) continue;
                const [namespace, ...rest] = route.titleKey.split(".");
                const key = rest.join(".");
                for (const locale of Object.keys(manifest.translations ?? {})) {
                    const value = manifest.translations?.[locale]?.[namespace]?.[key];
                    if (typeof value !== "string" || !value.trim()) {
                        missing.push(`${id}: ${route.titleKey} for ${locale} (${route.path})`);
                    }
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("does not just repeat the English in every locale", () => {
        // A module whose every title is identical across locales has almost
        // certainly copied rather than translated. Proper nouns are exempt by
        // being a minority of one module's titles rather than all of them.
        const untranslated: string[] = [];
        for (const { id, manifest } of modules) {
            const routes = (manifest.routes ?? []).filter((r) => r.titleKey);
            if (routes.length === 0) continue;
            const locales = Object.keys(manifest.translations ?? {});
            if (locales.length < 2) continue;
            const differs = routes.some((route) => {
                const [ns, ...rest] = route.titleKey!.split(".");
                const key = rest.join(".");
                const values = locales.map((l) => manifest.translations?.[l]?.[ns]?.[key]);
                return new Set(values).size > 1;
            });
            // "Blog" and "Form" are the same word in English and Turkish.
            // Every other module here has to differ somewhere.
            const properNouns = ["blog", "custom-forms"];
            if (!differs && !properNouns.includes(id)) untranslated.push(id);
        }
        expect(untranslated).toEqual([]);
    });
});
