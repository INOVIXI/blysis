/**
 * What a person writes on this site is Markdown.
 *
 * Content was authored in a Quill toolbar and stored as whatever HTML Quill
 * produced, which made the database the editor's output format: a paragraph
 * was `<p>` because Quill said so, and moving off Quill meant rewriting every
 * row. Markdown is the text somebody typed. It survives the editor, it reads
 * as itself in a database client, and it diffs.
 *
 * The HTML subset stays, because a page like a project's front matter needs
 * `<div align="center">` and Markdown has no way to say it. So the sanitiser
 * is the boundary rather than the parser: everything is rendered and then
 * everything is cleaned, whether it arrived as Markdown or as a tag.
 */
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@/core/lib/markdown";

describe("rendering what somebody wrote", () => {
    it("turns Markdown into the tags the stylesheet already dresses", () => {
        expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
        expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
        expect(renderMarkdown("- one\n- two")).toContain("<li>one</li>");
    });

    it("takes the GitHub spellings, which is what people type", () => {
        expect(renderMarkdown("~~gone~~")).toContain("<del>gone</del>");
        expect(renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("<table>");
    });

    /**
     * A document is the README rule: a line break in the source is where the
     * writer's line ended, not where the reader's does. It matters most for
     * the row of badges every project page opens with - written one per line
     * and meant to flow along one, which is how they read everywhere else
     * Markdown is written. Forcing a break stacked nine of them down the page.
     */
    it("joins the lines of a paragraph, the way a document does", () => {
        expect(renderMarkdown("one\ntwo")).not.toContain("<br>");
        const badges = "![a](https://x.test/a.svg)\n![b](https://x.test/b.svg)";
        expect(renderMarkdown(badges)).not.toContain("<br>");
    });

    /**
     * A member writes in a plain textarea with no preview and no second
     * chance. Under HTML their line breaks collapsed, so a post typed as
     * three lines arrived as one paragraph, and nothing on the screen had
     * told them it would.
     */
    it("keeps every line break where somebody typed into a box", () => {
        expect(renderMarkdown("one\ntwo", { keepLineBreaks: true })).toContain("<br>");
    });

    /**
     * The two the GFM specification names that were coming out wrong, both
     * because the sanitiser threw away what the parser had built: a list that
     * starts at five started at one, and a checklist rendered as a list of
     * sentences with a space where the box should be.
     */
    it("numbers a list from where the writer started it", () => {
        expect(renderMarkdown("5. five\n6. six")).toContain('<ol start="5">');
    });

    it("draws a task list as boxes, ticked and unticked", () => {
        const out = renderMarkdown("- [ ] todo\n- [x] done");
        expect(out).toMatch(/<input[^>]*type="checkbox"/);
        expect(out).toMatch(/<input[^>]*checked/);
        // Read-only: a reader ticking a box changes nothing anybody stored,
        // and a control that pretends otherwise is a lie.
        expect(out).toMatch(/<input[^>]*disabled/);
    });

    /**
     * `input` is the one tag on the allowlist that could be a control, and it
     * is there for exactly one thing. Left open it also accepted a password
     * box, which on somebody else's article is a phishing prop.
     */
    it("lets an input be a tick box and nothing else", () => {
        for (const type of ["text", "password", "image", "submit", "file"]) {
            expect(renderMarkdown(`<input type="${type}">`), type).not.toContain("<input");
        }
        expect(renderMarkdown('<input type="checkbox">')).toContain("<input");
    });

    /** Keys are typed as `<kbd>` and every host renders them. */
    it("keeps a keystroke", () => {
        expect(renderMarkdown("press <kbd>Ctrl</kbd>")).toContain("<kbd>Ctrl</kbd>");
    });

    /**
     * The three GitHub renders that `marked` alone does not. Footnotes were
     * the worst of them: `text[^1]` came out as a link to a page called
     * "note", which is wrong rather than missing.
     */
    it("carries a footnote to the bottom of the page", () => {
        const out = renderMarkdown("text[^1]\n\n[^1]: the note");
        expect(out).toContain("the note");
        expect(out).toMatch(/<sup|footnote/i);
        expect(out).not.toContain('href="note"');
    });

    it("draws an alert as the callout it is", () => {
        const out = renderMarkdown("> [!NOTE]\n> useful");
        expect(out).toMatch(/class="[^"]*alert/i);
        expect(out).not.toContain("[!NOTE]");
    });

    it("gives a heading an anchor somebody can link to", () => {
        expect(renderMarkdown("## A heading")).toMatch(/<h2 id="a-heading"/);
    });

    it("keeps the HTML a layout needs", () => {
        const out = renderMarkdown('<div align="center">\n\n# Centred\n\n</div>');
        expect(out).toContain("<div");
        expect(out).toContain('align="center"');
    });

    it("drops the HTML nothing needs", () => {
        expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script");
        expect(renderMarkdown('<img src=x onerror="alert(1)">')).not.toContain("onerror");
        expect(renderMarkdown('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
        expect(renderMarkdown('<iframe src="https://evil.test"></iframe>')).not.toContain("<iframe");
    });

    it("says nothing at all for nothing at all", () => {
        expect(renderMarkdown("")).toBe("");
        expect(renderMarkdown("   ")).toBe("");
    });
});
