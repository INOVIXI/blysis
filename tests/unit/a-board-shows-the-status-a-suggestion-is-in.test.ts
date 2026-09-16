import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { pageSource } from "./module-page-source";
import {
    SUGGESTION_STATUSES,
    STATUS_BADGE_CLASS,
    canonicalStatus,
    spellingsOf,
} from "../../module-sources/suggestions/lib/statuses";
import { suggestionUpdateSchema } from "../../module-sources/suggestions/lib/validations";

/**
 * Four lists of suggestion statuses, none of which agreed.
 *
 * The admin dropdown offered six. The schema that validates the request
 * accepted four of them, so choosing "Under Review" or "In Progress" answered
 * 400 and the screen said the operation had failed. The public board filtered
 * on `under_review`, `accepted` and `rejected` - spellings no suggestion could
 * ever hold - so three of its six filter buttons always returned an empty
 * board. And the board's badge fell back to the first word in its own map,
 * which meant a planned or a declined suggestion was labelled "Open" to every
 * visitor who read it.
 *
 * The six are the vocabulary now: the manifest already carried a name for each
 * of them in both languages, and the admin was already being offered all six.
 */

const MODULE = path.resolve(__dirname, "../../module-sources/suggestions");

function read(...parts: string[]): string {
    return fs.readFileSync(path.join(MODULE, ...parts), "utf8");
}

const MANIFEST = JSON.parse(read("module.json")) as {
    translations: Record<string, Record<string, Record<string, string>>>;
};

describe("one vocabulary of suggestion statuses", () => {
    it("names every status in both languages", () => {
        for (const locale of ["en", "tr"]) {
            const messages = MANIFEST.translations[locale].suggestions;
            const missing = SUGGESTION_STATUSES.filter((s) => !messages[s]);
            expect(missing, `${locale} has no word for ${missing.join(", ")}`).toEqual([]);
        }
    });

    it("accepts every status an admin can choose", () => {
        for (const status of SUGGESTION_STATUSES) {
            expect(suggestionUpdateSchema.safeParse({ status }).success, `${status} was rejected`).toBe(true);
        }
        expect(suggestionUpdateSchema.safeParse({ status: "invented" }).success).toBe(false);
    });

    it("gives every status its own look", () => {
        for (const status of SUGGESTION_STATUSES) {
            expect(STATUS_BADGE_CLASS[status], `${status} has no badge`).toBeTruthy();
        }
    });

    it("folds the spellings the old screens used", () => {
        expect(canonicalStatus("under_review")).toBe("underReview");
        expect(canonicalStatus("accepted")).toBe("planned");
        expect(canonicalStatus("rejected")).toBe("declined");
        expect(canonicalStatus("in_progress")).toBe("inProgress");
        expect(canonicalStatus("something-else")).toBeNull();
        for (const status of SUGGESTION_STATUSES) {
            for (const spelling of spellingsOf(status)) {
                expect(canonicalStatus(spelling), `${spelling} should name ${status}`).toBe(status);
            }
        }
    });
});

describe("both boards read the one list", () => {
    const admin = read("pages", "admin", "page.tsx");
    // The board moved into `components/`; the page reads it on the server.
    const board = pageSource(path.join(MODULE, "pages", "public", "page.tsx"), MODULE);
    const api = read("api", "route.ts");

    it("offers every status on both screens", () => {
        expect(admin).toContain("SUGGESTION_STATUSES.map");
        expect(board).toContain('["", ...SUGGESTION_STATUSES]');
        expect(admin).toContain('["all", ...SUGGESTION_STATUSES]');
    });

    it("never falls back to a status the row is not in", () => {
        // `t(statusKeys[s.status] || "open")` is how a declined suggestion came
        // to be labelled Open.
        expect(board).not.toContain('|| "open"');
        for (const source of [admin, board]) {
            expect(source).toContain("canonicalStatus(");
        }
    });

    it("filters and pages the admin board in the same query", () => {
        expect(admin).toContain('params.set("status", filter)');
        // Two hundred asked for, a hundred returned by the cap, all of them
        // rendered, and no way to the ones behind them.
        expect(admin).not.toContain("limit=200");
        expect(admin).toContain("<Pagination");
    });

    /**
     * The filter lives in the read both the board and the endpoint call, so a
     * status asked for in an address and one asked for over HTTP cannot mean
     * two different things.
     */
    it("filters through the fold, once, for both callers", () => {
        const shared = read("lib", "read-suggestions.ts");
        expect(shared).toContain("canonicalStatus(options.status)");
        expect(shared).toContain("spellingsOf(canonical)");
        expect(api).toContain("readSuggestions(");
        expect(board).toContain("readSuggestions(");
    });

    it("leaves no second list of statuses behind", () => {
        for (const source of [admin, board]) {
            expect(source).not.toContain("statusKeys");
            expect(source).not.toContain("STATUS_OPTIONS");
            expect(source).not.toMatch(/under_review|accepted:|rejected:/);
        }
    });
});
