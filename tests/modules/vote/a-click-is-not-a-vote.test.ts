import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The site counted clicks and called them votes.
 *
 * Pressing the button opens the listing in a new tab and then posts to
 * `/vote/record`, from the member's own browser. No listing ever calls back,
 * so the row means "somebody went", and that is the only part this site can
 * see. Whether they then voted, whether the listing accepted it, whether they
 * closed the tab - none of it reaches here.
 *
 * The screen said "Total votes" next to the number and "your vote was
 * counted" in the toast, and the ranking said "top voters". Every one of
 * those is a claim about something the site does not know, on the screens a
 * member reads about themselves, which is the same rule as 11a from the other
 * direction: not a machine name reaching a reader, but a fact that is not one.
 *
 * This file is here because the wording reads like a downgrade and the next
 * person to tidy the catalogue will want to put "vote" back. It may go back
 * the day a listing's postback reaches this module and the count becomes
 * true - and then this test is what has to be deleted deliberately.
 */

const ROOT = join(__dirname, "../../..");
const manifest = JSON.parse(readFileSync(join(ROOT, "module-sources/vote/module.json"), "utf-8"));

/** What the reader is shown, in both languages. */
function reader(locale: string): Record<string, string> {
    return manifest.translations[locale].vote as Record<string, string>;
}

describe("a click is not a vote", () => {
    it("has no listing calling back, which is why the wording is what it is", () => {
        // The moment one does, this is the line that stops being true and the
        // whole file should be reconsidered rather than worked around.
        const declared = (manifest.api ?? []) as { providerCallback?: boolean; openTo?: string }[];

        expect(declared.some((entry) => entry.providerCallback)).toBe(false);
    });

    it("counts clicks on the label beside the number", () => {
        // Whole words. A substring check let "Toplam Oy" through, because the
        // word it was looking for was spelled with a trailing space.
        const CLAIMS_A_VOTE = /\b(vote|votes|oy|oyu|oylar)\b/;
        for (const locale of ["en", "tr"]) {
            const label = reader(locale).totalVotes.toLocaleLowerCase(locale);
            expect(label, `${locale}: ${label}`).not.toMatch(CLAIMS_A_VOTE);
            expect(label, locale).toMatch(/click|tıklan/);
        }
    });

    it("does not tell a member their vote was counted", () => {
        // It was not. The listing was opened; that is what they are told.
        expect(reader("en").voteRecorded.toLowerCase()).not.toContain("vote was counted");
        expect(reader("tr").voteRecorded.toLowerCase()).not.toContain("oyunuz sayıldı");
    });

    it("ranks by what it can see", () => {
        expect(reader("en").leaderboardVoters.toLowerCase()).toContain("click");
        expect(reader("tr").leaderboardVoters.toLowerCase()).toContain("tıklama");
    });

    it("says on the page which half is the site's and which is the listing's", () => {
        // The one sentence that makes the rest of it make sense, rather than
        // reading as a product that is bad at counting.
        expect(reader("en").description.toLowerCase()).toContain("the listing counts the vote");
        expect(reader("tr").description.toLowerCase()).toContain("oyu site sayar");
    });

    it("keeps no label nothing draws", () => {
        // `topVoters` sat beside `leaderboardVoters` and was never rendered;
        // it is the kind of key that survives a rewording and then reappears.
        for (const locale of ["en", "tr"]) {
            expect(reader(locale).topVoters, locale).toBeUndefined();
        }
    });
});
