import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { pageSource } from "./module-page-source";
import {
    PUNISHMENT_TYPES,
    canonicalType,
    spellingsOf,
} from "../../module-sources/punishments/lib/punishment-types";

/**
 * The two screens of one module have to mean the same thing by the same word.
 *
 * The admin form offered six punishment types and stored what it offered. The
 * public page knew four, spelled one of them differently, and used its own
 * list for the filter buttons, the icons, the colours and the labels. So the
 * Warning filter sent `?type=warn` and matched nothing an admin had created;
 * there was no filter at all for either temporary type; and a warning, a
 * tempBan and a tempMute printed the raw database value beside a fallback
 * icon, with the translation for each of the three already sitting in this
 * module's manifest in both languages.
 *
 * Nothing failed. The filter simply returned an empty table, which is what an
 * empty table looks like.
 */

const MODULE = path.resolve(__dirname, "../../module-sources/punishments");

function read(...parts: string[]): string {
    return fs.readFileSync(path.join(MODULE, ...parts), "utf8");
}

/** A page plus the screen it renders: the public list moved to `components/`. */
function screen(...parts: string[]): string {
    return pageSource(path.join(MODULE, ...parts), MODULE);
}

const MANIFEST = JSON.parse(read("module.json")) as {
    translations: Record<string, Record<string, Record<string, string>>>;
};

describe("one vocabulary of punishment types", () => {
    it("names every type in both languages", () => {
        for (const locale of ["en", "tr"]) {
            const messages = MANIFEST.translations[locale].punishments;
            const missing = PUNISHMENT_TYPES.filter((type) => !messages[type]);
            expect(missing, `${locale} has no word for ${missing.join(", ")}`).toEqual([]);
        }
    });

    it("folds a spelling to the type it names", () => {
        for (const type of PUNISHMENT_TYPES) {
            expect(canonicalType(type)).toBe(type);
        }
        expect(canonicalType("warn")).toBe("warning");
        expect(canonicalType("TEMP_BAN")).toBe("tempBan");
        expect(canonicalType("tempmute")).toBe("tempMute");
        expect(canonicalType("shadowban")).toBeNull();
    });

    it("keeps every spelling of a type findable", () => {
        expect(spellingsOf("warning")).toContain("warn");
        expect(spellingsOf("tempBan")).toContain("tempban");
        for (const type of PUNISHMENT_TYPES) {
            for (const spelling of spellingsOf(type)) {
                expect(canonicalType(spelling), `${spelling} should name ${type}`).toBe(type);
            }
        }
    });

    it("leaves an unknown type to be printed as it stands", () => {
        expect(canonicalType("something-a-plugin-invented")).toBeNull();
    });
});

describe("both screens read the one list", () => {
    const admin = read("pages", "admin", "page.tsx");
    const publicPage = screen("pages", "public", "page.tsx");
    const api = read("api", "route.ts");

    it("offers the shared list on the admin form", () => {
        expect(admin).toContain("PUNISHMENT_TYPES.map");
    });

    it("filters the public page by the shared list", () => {
        // The shape moved from a row of buttons to a select inside the shared
        // filter strip, so the spelling is no longer `["", ...TYPES]`. What is
        // being defended is the same: the public filter is built from the one
        // list and not a second copy of it.
        expect(publicPage).toContain("PUNISHMENT_TYPES.map");
    });

    it("labels a row through the shared fold on both screens", () => {
        expect(admin).toContain("canonicalType(");
        expect(publicPage).toContain("canonicalType(");
    });

    it("stores through the shared fold", () => {
        expect(api).toContain("canonicalType(type)");
    });

    /**
     * The filter lives in the read both the page and the endpoint call, so a
     * type asked for in an address and a type asked for over HTTP cannot mean
     * two different things.
     */
    it("filters through the shared fold, once, for both callers", () => {
        const shared = read("lib", "read-punishments.ts");
        expect(shared).toContain("spellingsOf(canonical)");
        expect(api).toContain("readPunishments(");
        expect(publicPage).toContain("readPunishments(");
    });

    it("leaves no second list of type names behind", () => {
        for (const source of [admin, publicPage]) {
            expect(source).not.toMatch(/"ban",\s*"mute"/);
            expect(source).not.toContain("TYPE_OPTIONS");
        }
    });
});
