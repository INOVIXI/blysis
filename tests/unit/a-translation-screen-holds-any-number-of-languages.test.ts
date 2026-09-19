// @vitest-environment node
/**
 * The translations screen works whatever number of languages a site serves.
 *
 * It was built for two and says so in its own markup: `md:grid-cols-2`, one
 * box per locale, every locale on every row. With the two this site ships,
 * fifty keys made a page twelve thousand seven hundred pixels tall. At twenty
 * it would be ten rows of boxes per key and a thousand boxes on the page, and
 * the endpoint would send every language's text for every key whether or not
 * anybody was working on it.
 *
 * The reason for putting them side by side was a good one and is written down
 * in that file: an operator who corrects the English and never sees that the
 * Turkish still says the old thing leaves the site half translated. That
 * argument is about a *pair* - what you are translating from and what you are
 * translating into - and it survives: the screen shows the source beside one
 * language at a time, chosen by the operator, instead of all of them at once.
 *
 * And it answers the question the old screen could not: which languages are
 * behind. A count per language, over the whole catalogue rather than the page.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const SCREEN = path.join(ROOT, "src/app/[locale]/(admin)/admin/translations");
const read = (rel: string) => fs.readFileSync(path.join(SCREEN, rel), "utf8");

describe("the translations screen", () => {
    it("does not build its columns out of the list of languages", () => {
        /*
         * Two columns is right and stays right: a source and the one thing
         * being translated into it. What was wrong was where the columns came
         * from - one per locale, so the grid grew with the list and at twenty
         * languages became ten rows of boxes on every single key.
         */
        const row = read("TranslationEntry.tsx");
        expect(row).not.toMatch(/locales\.map\([\s\S]{0,400}?<Textarea/);
    });

    it("draws the language being worked on, not every language there is", () => {
        const row = read("TranslationEntry.tsx");
        // The tell of the old shape: a box per locale, for every locale.
        expect(row).not.toMatch(/locales\.map\(\(locale\)\s*=>\s*\{[\s\S]*<Textarea/);
        expect(row).toContain("target");
        expect(row).toContain("source");
    });

    it("lets the operator choose which language they are working in", () => {
        expect(read("page.tsx")).toContain("translations_workingIn");
    });

    it("asks the endpoint for that language rather than filtering in the browser", () => {
        const route = fs.readFileSync(path.join(ROOT, "src/app/api/v1/admin/translations/route.ts"), "utf8");
        expect(route).toContain('searchParams.get("locale")');
    });
});

describe("how far behind each language is", () => {
    it("is counted over the whole catalogue, not the page in front of the reader", () => {
        const route = fs.readFileSync(
            path.join(ROOT, "src/app/api/v1/admin/translations/filters/route.ts"),
            "utf8",
        );
        expect(route).toContain("missing");
        expect(route).toContain("groupBy");
    });

    it("is shown, because otherwise nobody knows which language to open", () => {
        expect(read("page.tsx")).toContain("translations_behind");
    });
});

describe("a locale a site does not serve", () => {
    it("cannot be asked for, whatever arrives in the query", () => {
        const route = fs.readFileSync(path.join(ROOT, "src/app/api/v1/admin/translations/route.ts"), "utf8");
        // `z.enum(locales)` is what stops `?locale=' OR 1=1` reaching a query
        // that interpolates it, and what stops a page of nothing being
        // reported as a language with every string missing.
        expect(route).toMatch(/locale:\s*z\.enum\(locales\)/);
    });
});
