// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { nextKindOrder } from "@/modules/changelog/lib/types";

/**
 * What kind of release a note is, is the operator's vocabulary, not ours.
 *
 * Six kinds were written into the module as an `as const` array - feature,
 * improvement, fix, security, removed, breaking - with a colour each and a
 * translation key each. Six good words, and six is not every community's six.
 * A shop that ships a seasonal event, a server that posts a map reset, anybody
 * who wants "Known issue": none of them could say so, and none of the six
 * could be taken away either.
 *
 * The shape is the one the punishments module already uses for its places: a
 * table the operator edits on a screen of its own, and the thing being
 * created picks from it.
 *
 * Two decisions worth writing down.
 *
 * A kind an operator adds carries the word they typed and nothing else - the
 * six shipped ones carry a `nameKey` instead, so they stay translated. That
 * is the same split `PunishmentScope` makes between a name a reader sees and
 * a `matchKey` nothing draws.
 *
 * And an entry keeps holding the kind's key as a string rather than pointing
 * at a row. Deleting a kind is something the maintainer explicitly asked for,
 * and a foreign key would make that either impossible or destructive; the
 * label already falls back to printing an unknown key as it stands, which is
 * what a release written under a kind that has since gone should do.
 */

const ROOT = path.resolve(__dirname, "../../..");
const MODULE = path.join(ROOT, "module-sources/changelog");
const read = (rel: string) => fs.readFileSync(path.join(MODULE, rel), "utf8");
const manifest = () => JSON.parse(read("module.json"));

describe("a kind of release", () => {
    it("is a row an operator can add to, not a list in the source", () => {
        expect(read("schema.prisma")).toContain("model ChangelogType");
    });

    it("arrives as a numbered migration, because this module has shipped", () => {
        const dir = path.join(MODULE, "migrations");
        const sql = fs.readdirSync(dir)
            .filter((f) => f.endsWith(".sql"))
            .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
            .join("\n");
        expect(sql).toContain('"ChangelogType"');
    });

    it("carries either a key the module translates or a word somebody typed", () => {
        const schema = read("schema.prisma");
        expect(schema).toContain("nameKey");
        expect(schema).toContain("name");
    });

    it("can be managed on a screen of its own, not on the form that writes a release", () => {
        const api = manifest().api as { path: string }[];
        expect(api.map((e) => e.path)).toContain("/changelog/types");
        const adminRoutes = manifest().adminRoutes as { path: string }[];
        expect(adminRoutes.map((e) => e.path)).toContain("/changelog/types");
        // C9's lesson: a settings editor at the top of a create form is why
        // the punishments screen could not be worked out.
        const form = read("pages/admin/page.tsx");
        expect(form).not.toContain("TypeManager");
    });
});

describe("the six this module ships", () => {
    it("are seeded rather than hardcoded into the screens", () => {
        const lib = read("lib/types.ts");
        expect(lib).toContain("DEFAULT_TYPES");
        for (const kind of ["feature", "improvement", "fix", "security", "removed", "breaking"]) {
            expect(lib, kind).toContain(`"${kind}"`);
        }
    });

    it("keep their translations, because they are the module's own words", () => {
        const translations = manifest().translations;
        for (const locale of ["en", "tr"]) {
            const cat = translations[locale]?.changelog ?? {};
            for (const kind of ["feature", "improvement", "fix", "security", "removed", "breaking"]) {
                expect(typeof cat[`type_${kind}`], `${locale} type_${kind}`).toBe("string");
            }
        }
    });
});

describe("the screens", () => {
    it("read the kinds from the table rather than from the array", () => {
        expect(read("pages/admin/page.tsx")).not.toContain("CHANGELOG_TYPES");
    });

    it("draw a kind nobody declared as the word it is, not as the first in the list", () => {
        // A release written under a kind that has since been deleted still
        // has to say something, and folding it into the first entry would
        // label a breaking change "feature".
        expect(read("lib/types.ts")).toContain("changelogTypeLabel");
    });
});

describe("a kind an operator adds", () => {
    /*
     * It goes after the ones already there.
     *
     * The column defaults to 0 and the six shipped kinds are seeded at 10 to
     * 60, so a kind somebody added landed above all of them: typing "Known
     * issue" put it at the top of the list on the manager and first in the
     * dropdown on the form that writes a release, ahead of "Feature". Nothing
     * asked for that, and the row an operator adds is the one they know least
     * about.
     */
    it("goes to the end of the list, not to the top of it", () => {
        expect(nextKindOrder(60)).toBeGreaterThan(60);
    });

    it("starts the list where there is nothing to go after", () => {
        expect(nextKindOrder(null)).toBeGreaterThan(0);
    });
});
