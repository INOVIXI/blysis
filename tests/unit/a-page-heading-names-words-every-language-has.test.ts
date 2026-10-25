/**
 * The words a theme gives a page's heading are there in every language.
 *
 * A heading's label, title or line may name a message, which is drawn in the
 * reader's language, or be words as written. A name that leads to nothing is
 * drawn as written too, so a misspelt key reached the page as
 * "kite.storeKiker" and only a reader would notice. Anything that reads like
 * a key, a dotted name with no space in it, must be a message in every
 * language the site speaks: in the theme's own catalogue or one the site
 * ships.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { locales } from "@/core/lib/i18n/config";
import { messageAt } from "@/core/lib/i18n/shipped-messages";

const ROOT = process.cwd();
const THEMES = path.join(ROOT, "src/themes");
const MODULES = path.join(ROOT, "module-sources");
const KEY_LIKE = /^[A-Za-z][\w-]*(\.[\w-]+)+$/;

type Catalogue = Record<string, unknown>;

const SHIPPED = new Map<string, Catalogue[]>(locales.map((locale) => [locale, [
    JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8")) as Catalogue,
    ...fs.readdirSync(MODULES)
        .map((id) => path.join(MODULES, id, "module.json"))
        .filter((file) => fs.existsSync(file))
        .map((file) => (JSON.parse(fs.readFileSync(file, "utf8")).translations?.[locale] ?? {}) as Catalogue),
]]));

function says(catalogue: Catalogue, name: string): boolean {
    const [namespace, ...rest] = name.split(".");
    const tree = Object.prototype.hasOwnProperty.call(catalogue, namespace) ? catalogue[namespace] : undefined;
    return !!tree && typeof tree === "object" && messageAt(tree as Record<string, unknown>, rest.join(".")) !== null;
}

interface ThemeWords {
    layouts?: Record<string, { heading?: Record<string, string> }>;
    translations?: Record<string, Catalogue>;
}

/** Every heading word of a theme that names a message some language lacks. */
function missing(id: string, theme: ThemeWords): { named: number; problems: string[] } {
    let named = 0;
    const problems: string[] = [];
    for (const [page, layout] of Object.entries(theme.layouts ?? {})) {
        for (const [part, value] of Object.entries(layout.heading ?? {})) {
            if (!KEY_LIKE.test(value)) continue;
            named++;
            for (const locale of locales) {
                const own = theme.translations?.[locale] ?? {};
                if (says(own, value) || (SHIPPED.get(locale) ?? []).some((c) => says(c, value))) continue;
                problems.push(`${id} ${page} ${part}: "${value}" is no message in ${locale}`);
            }
        }
    }
    return { named, problems };
}

const THEME_IDS = fs.readdirSync(THEMES).filter((id) => fs.existsSync(path.join(THEMES, id, "theme.json")));

describe("a page heading's words", () => {
    for (const id of THEME_IDS) {
        it(`${id} names only messages every language has`, () => {
            const theme = JSON.parse(fs.readFileSync(path.join(THEMES, id, "theme.json"), "utf8")) as ThemeWords;
            expect(missing(id, theme).problems).toEqual([]);
        });
    }

    it("sees a misspelt name, and lets words as written stand", () => {
        const { named, problems } = missing("fixture", {
            layouts: { "store.home": { heading: { kicker: "fixture.kiker", title: "Market day", description: "store.title" } } },
            translations: Object.fromEntries(locales.map((l) => [l, { fixture: { kicker: "Shop" } }])),
        });
        expect(named).toBe(2);
        expect(problems).toEqual(locales.map((l) => `fixture store.home kicker: "fixture.kiker" is no message in ${l}`));
    });
});
