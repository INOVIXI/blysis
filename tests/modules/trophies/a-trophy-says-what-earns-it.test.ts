// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A trophy says what earns it, in words an operator can choose between.
 *
 * The rule was one free text box. An operator had to know that the string
 * `forum.topic.created` exists, spell it exactly, and know it is the one the
 * engine counts - and a misspelling made a trophy that can never be awarded
 * to anybody, with nothing on the screen to say so. The site knows the list:
 * every kind of activity anything writes is declared in a manifest and named
 * in both languages, because `a-machine-name-is-not-a-label` makes it so.
 * Nineteen of them, each with a word for it.
 *
 * And there was one condition. A trophy for somebody who has written ten
 * forum posts and made a purchase could not be described at all, which is
 * what "more than one condition" means.
 *
 * The old columns stay and keep working. `ruleEvent`/`ruleThreshold` is what
 * every trophy in the database holds today, and a module's migrations are
 * forward-only and additive.
 */

const ROOT = path.resolve(__dirname, "../../..");
const MODULE = path.join(ROOT, "module-sources/trophies");
const read = (rel: string) => fs.readFileSync(path.join(MODULE, rel), "utf8");

describe("the kinds a trophy can be earned by", () => {
    it("are offered by core, rather than each screen knowing them", () => {
        const sdk = fs.readFileSync(path.join(ROOT, "src/core/sdk/ui.ts"), "utf8");
        expect(sdk).toContain("activityKinds");
        const lib = fs.readFileSync(path.join(ROOT, "src/core/lib/activity-title.ts"), "utf8");
        expect(lib).toContain("export function activityKinds");
    });

    it("are what the form offers, instead of a box to type one into", () => {
        const screen = read("pages/admin/page.tsx");
        expect(screen).toContain("activityKinds");
        // The tell of the old shape: a plain text input bound to the event.
        expect(screen).not.toMatch(/<Input[^>]*value=\{[^}]*ruleEvent/);
    });
});

describe("a trophy's conditions", () => {
    it("are a list, not a single pair of columns", () => {
        expect(read("schema.prisma")).toContain("rules");
        expect(read("lib/validations.ts")).toContain("trophyRuleSchema");
    });

    it("say whether all of them or any of them earns it", () => {
        // The list the endpoints validate against, so a mode outside it is a
        // 400 rather than a column holding a word the engine reads as "all".
        expect(read("lib/validations.ts")).toContain("RULES_MODES");
        expect(read("api/admin/route.ts")).toContain("rulesMode");
        expect(read("lib/trophy-engine.ts")).toContain("rulesMode");
    });

    it("arrive as a numbered migration, because this module has shipped", () => {
        // By what it does, not by what it is called: a migration is named
        // for the guarantee it adds, and matching on a column name is the
        // thing that stays true if somebody renames the file.
        const dir = path.join(MODULE, "migrations");
        const sql = fs.readdirSync(dir)
            .filter((f) => f.endsWith(".sql"))
            .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
            .join("\n");
        expect(sql).toContain('ADD COLUMN IF NOT EXISTS "rules"');
        expect(sql).toContain('ADD COLUMN IF NOT EXISTS "rulesMode"');
    });

    it("still work where only the old columns are filled", () => {
        // Every trophy in every database today is one `ruleEvent` and one
        // `ruleThreshold`. Reading those as a list of one is what keeps them
        // being awarded.
        const engine = read("lib/trophy-engine.ts");
        expect(engine).toContain("trophyConditions");
    });
});

describe("the trophy form", () => {
    const screen = read("pages/admin/page.tsx");

    it("picks an icon rather than asking for its name", () => {
        expect(screen).toContain("IconPicker");
        expect(screen).not.toContain("adm_lucideIcon");
    });

    it("does not offer a choice with one option in it", () => {
        // `ruleType` has had exactly one value since it was written, and the
        // select printed that value rather than a name for it.
        expect(screen).not.toMatch(/value="event-count"/);
    });
});
