// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * A module says what it is called and what it does, in both languages.
 *
 * A manifest's `name` and `description` are English, the way every string in a
 * manifest is, and the module is expected to ship `admin.module_<id>_name` and
 * `_description` beside them. `moduleName` falls back to the manifest when it
 * finds no string - a fallback that exists for a marketplace row nothing is
 * installed for - and that fallback was quietly carrying nine installed
 * modules. On the Turkish modules screen, among eighty-nine cards, nine read
 * their name and their whole description in English: "A live chat bubble on
 * every page, served by Crisp", "Publishes this shop's paid orders for
 * BirFatura to pull and invoice".
 *
 * Thirty-six missing rows, and nothing anywhere said so, because a missing
 * string does not look missing - it looks like a translation somebody forgot.
 */

const ROOT = path.resolve(__dirname, "../..");
const MODULES = path.join(ROOT, "module-sources");
const LOCALES = ["en", "tr"] as const;

interface Manifest {
    id: string;
    translations?: Record<string, Record<string, Record<string, string>>>;
}

function manifests(): Manifest[] {
    return fs.readdirSync(MODULES)
        .map((id) => path.join(MODULES, id, "module.json"))
        .filter((file) => fs.existsSync(file))
        .map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as Manifest);
}

describe("every installed module", () => {
    const all = manifests();

    it("finds the manifests, so a broken scan cannot pass quietly", () => {
        expect(all.length).toBeGreaterThan(40);
    });

    it("carries its own name and description in every locale the site serves", () => {
        const missing: string[] = [];
        for (const manifest of all) {
            for (const locale of LOCALES) {
                const admin = manifest.translations?.[locale]?.admin ?? {};
                for (const what of ["name", "description"] as const) {
                    const key = `module_${manifest.id}_${what}`;
                    if (typeof admin[key] !== "string" || !admin[key].trim()) {
                        missing.push(`${manifest.id} ${locale}: admin.${key}`);
                    }
                }
            }
        }
        expect(missing, "the modules screen falls back to the manifest's English, which does not look missing").toEqual([]);
    });

    it("is not named by core, which knows no module", () => {
        const named: string[] = [];
        for (const locale of LOCALES) {
            const core = JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8"));
            for (const key of Object.keys(core.admin ?? {})) {
                if (/^module_.+_(name|description)$/.test(key)) named.push(`${locale}: admin.${key}`);
            }
        }
        expect(named).toEqual([]);
    });
});

describe("the modules screen", () => {
    const screen = fs.readFileSync(path.join(ROOT, "src/app/[locale]/(admin)/admin/modules/page.tsx"), "utf8");

    it("can be searched, because eighty-nine cards is not a list anybody reads", () => {
        expect(screen).toContain("ListControls");
    });

    it("gives its cards one height, so a row is not as tall as its longest card", () => {
        /*
         * A grid row is as tall as the tallest card in it, so one with a
         * three line description and a dependency badge stretched the two
         * beside it and left their buttons floating in the middle of nothing.
         * `h-full` on the card and a column that pushes its actions down is
         * what makes the row look deliberate; `mt-auto` on a button inside a
         * card that is not itself full height does nothing at all, which is
         * what was there.
         */
        // Comments stripped, and no window: the note explaining this very
        // rule sits between the map and the card, and a fixed window would
        // have been pushed past the thing it is looking for by the sentence
        // describing it.
        const card = stripComments(screen).slice(screen.indexOf("installedToShow.map") - 200);
        expect(card).toMatch(/<Card[^>]*className=\{`h-full/);
        expect(card).toContain("flex h-full flex-col");
    });
});
