// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A ticket reply is written and read the way everything else on this site is.
 *
 * What a person writes here is Markdown - an article, a forum post, a
 * suggestion and its comments all are - and a ticket was the exception at
 * both ends: typed into a bare box and printed back with `whitespace-pre-wrap`,
 * so a member who wrote a list got their asterisks back and a staff answer
 * that wanted a link had to paste a bare URL.
 *
 * Both ends, deliberately. Giving the staff an editor while the member's
 * words are still printed verbatim would make the conversation read
 * differently depending on who wrote the line, in the same thread.
 *
 * And the sidebar told an operator the status twice in two vocabularies: a
 * select reading CLOSED and, ten centimetres below it, a badge reading
 * "Kapatıldı". The helper that names one was already imported for the other.
 */

const ROOT = path.resolve(__dirname, "../../..");
const MODULE = path.join(ROOT, "module-sources/tickets");
const read = (rel: string) => fs.readFileSync(path.join(MODULE, rel), "utf8");

const ADMIN = "pages/admin/tickets/[id]/page.tsx";
const MEMBER = "pages/public/tickets/[id]/page.tsx";

describe("a ticket message", () => {
    it("is rendered as what it is, on both sides", () => {
        for (const screen of [ADMIN, MEMBER]) {
            const source = read(screen);
            expect(source, screen).toContain("RichContent");
            expect(source, screen).toContain("keepLineBreaks");
            expect(source, screen).not.toMatch(/whitespace-pre-wrap">\{(msg|message)\.content\}/);
        }
    });

    it("is written in the same editor on both sides", () => {
        for (const screen of [ADMIN, MEMBER]) {
            expect(read(screen), screen).toContain("RichTextEditor");
        }
    });
});

describe("the ticket sidebar", () => {
    const source = read(ADMIN);

    it("names a status rather than printing the column", () => {
        expect(source).not.toContain('{s.replace("_", " ")}');
        expect(source).not.toMatch(/<option key=\{p\} value=\{p\}>\{p\}<\/option>/);
        // The maps were per-screen and then shared; the states are rows an
        // operator writes now, so the word comes from the row the ticket
        // holds rather than from a map of five keys.
        expect(source).toContain("stateLabel(t, s, states.statuses)");
        expect(source).toContain("stateLabel(t, p, states.priorities)");
    });

    it("says each of those once, not once as a control and again as a badge", () => {
        // Two cards, one above the other, both answering "what state is this
        // ticket in" - and disagreeing about the words for it.
        const statusRows = source.match(/adm_status/g) ?? [];
        expect(statusRows.length).toBeLessThanOrEqual(2);
    });
});

describe("a closed ticket", () => {
    it("says why there is no reply box, rather than simply not having one", () => {
        expect(read(ADMIN)).toContain("adm_closedNoReply");
    });
});
