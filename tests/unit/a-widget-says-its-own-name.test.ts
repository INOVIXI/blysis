import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { widgetLabel, nameFromId } from "@/core/lib/widget-label";

/**
 * A homepage widget had no name.
 *
 * `widgets` was the one manifest capability that declared no label at all, so
 * Admin > Settings > Widgets built one by splitting the component id on its
 * capitals: "Featured Product Widget", "Top Credit Loaders Widget". That is
 * English in every locale, it repeats the word "widget" in a list of nothing
 * but widgets, and for a module whose ids are not written in English it is
 * not a name so much as a transliteration of a class name.
 *
 * Every other labelled capability - nav links, footer links, dashboard cards,
 * dashboard sections - already carried `label` plus an optional `labelKey`.
 * Widgets carry them now too, resolved in the shared `admin` namespace, and
 * this gate holds the four parts together: the manifest declares them, the
 * generator carries them, the module ships the string in every locale it
 * translates, and no two modules claim the same key in a namespace they share.
 */

const ROOT = path.resolve(__dirname, "../..");
const SOURCES = path.join(ROOT, "module-sources");

interface Widget {
    id: string;
    label?: string;
    labelKey?: string;
}

interface Manifest {
    id: string;
    widgets?: Widget[];
    translations?: Record<string, Record<string, Record<string, unknown>>>;
}

function manifests(): Manifest[] {
    return fs.readdirSync(SOURCES, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(SOURCES, e.name, "module.json"))
        .filter((p) => fs.existsSync(p))
        .map((p) => JSON.parse(fs.readFileSync(p, "utf8")) as Manifest);
}

describe("a widget's name", () => {
    const all = manifests();
    const withWidgets = all.filter((m) => (m.widgets ?? []).length > 0);

    it("finds the manifests and the widgets", () => {
        expect(all.length).toBeGreaterThan(40);
        expect(withWidgets.flatMap((m) => m.widgets!).length).toBeGreaterThan(5);
    });

    it("is declared by every widget", () => {
        const missing: string[] = [];
        for (const m of withWidgets) {
            for (const w of m.widgets!) {
                if (!w.label?.trim()) missing.push(`${m.id}.${w.id} label`);
                if (!w.labelKey?.trim()) missing.push(`${m.id}.${w.id} labelKey`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("does not repeat the word widget in a list of widgets", () => {
        const noisy: string[] = [];
        for (const m of withWidgets) {
            for (const w of m.widgets!) {
                if (/\bwidget\b/i.test(w.label ?? "")) noisy.push(`${m.id}.${w.id}: ${w.label}`);
            }
        }
        expect(noisy).toEqual([]);
    });

    it("ships the key in every locale the module translates", () => {
        const gaps: string[] = [];
        for (const m of withWidgets) {
            const locales = Object.keys(m.translations ?? {});
            expect(locales.length, `${m.id} declares widgets but no translations`).toBeGreaterThan(0);
            for (const locale of locales) {
                const admin = (m.translations?.[locale]?.admin ?? {}) as Record<string, unknown>;
                for (const w of m.widgets!) {
                    if (!w.labelKey) continue;
                    const value = admin[w.labelKey];
                    if (typeof value !== "string" || !value.trim()) gaps.push(`${m.id} ${locale} admin.${w.labelKey}`);
                }
            }
        }
        expect(gaps).toEqual([]);
    });

    it("gives each module its own key, since the namespace is shared", () => {
        const owner = new Map<string, string>();
        const clashes: string[] = [];
        for (const m of withWidgets) {
            for (const w of m.widgets!) {
                if (!w.labelKey) continue;
                const previous = owner.get(w.labelKey);
                if (previous && previous !== m.id) clashes.push(`admin.${w.labelKey}: ${previous} and ${m.id}`);
                owner.set(w.labelKey, m.id);
            }
        }
        expect(clashes).toEqual([]);
    });
});

describe("the manifest contract", () => {
    const schema = fs.readFileSync(path.join(ROOT, "src/core/lib/module-manifest-schema.ts"), "utf8");

    it("accepts label and labelKey on a widget", () => {
        const entry = schema.slice(schema.indexOf("const widgetEntry = z.object("));
        const body = entry.slice(0, entry.indexOf("});"));
        expect(body).toContain("label:");
        expect(body).toContain("labelKey:");
    });

    it("carries them through the generated registry", () => {
        const generator = fs.readFileSync(path.join(ROOT, "scripts/generate-registry.ts"), "utf8");
        expect(generator).toContain("export const ModuleWidgets: { id: string; label?: string; labelKey?: string;");
    });
});

describe("the screen that renders it", () => {
    const page = fs.readFileSync(
        path.join(ROOT, "src/app/[locale]/(admin)/admin/settings/widgets/WidgetSettingsScreen.tsx"),
        "utf8",
    );

    it("goes through the resolver rather than splitting the id itself", () => {
        expect(page).toContain("widgetLabel(");
        expect(page).not.toContain('replace(/([A-Z])/g, " $1")');
    });

    it("warns when every widget is switched off", () => {
        // The homepage cannot tell an intentional empty sidebar from an
        // accidental one, so the screen that caused it has to.
        expect(page).toContain("widgets_allHidden");
    });
});

describe("widgetLabel", () => {
    const has = (keys: string[]) => (key: string) => keys.includes(key);
    const translate = (key: string) => `translated:${key}`;

    it("prefers the translated key", () => {
        const label = widgetLabel(
            { id: "FeaturedProductWidget", label: "Featured Product", labelKey: "widget_featuredProduct" },
            has(["widget_featuredProduct"]),
            translate,
        );
        expect(label).toBe("translated:widget_featuredProduct");
    });

    it("falls back to the literal when the key is not seeded yet", () => {
        const label = widgetLabel(
            { id: "FeaturedProductWidget", label: "Featured Product", labelKey: "widget_featuredProduct" },
            has([]),
            translate,
        );
        expect(label).toBe("Featured Product");
    });

    it("falls back to the id for a widget that predates the field", () => {
        expect(widgetLabel({ id: "TopCreditLoadersWidget" }, has([]), translate)).toBe("Top Credit Loaders");
    });

    it("does not leave the word widget on the end of the id", () => {
        expect(nameFromId("DiscordWidget")).toBe("Discord");
        expect(nameFromId("Slider")).toBe("Slider");
    });
});
