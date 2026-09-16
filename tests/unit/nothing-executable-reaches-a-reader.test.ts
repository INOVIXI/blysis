import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@/core/lib/markdown";

/**
 * Every piece of writing on the site - blog articles, forum posts, help
 * articles, custom pages, announcements - passes through here on the way to
 * a reader. It is the only gate, and it is the last one: whatever gets past
 * this function is what a browser is handed.
 *
 * These cases were written against a sanitiser that ran on the way *in*,
 * before the column held Markdown. Cleaning on write could not tell a code
 * fence documenting `<script>` from a script, and deleted the writer's
 * example; it could not tell `a < b` from a tag, and stored five characters
 * where two belonged. So the cleaning moved to where the parser has already
 * decided which is which, and every payload below moved with it.
 *
 * This is also the mitigation of record for the editor's own advisories: the
 * editor runs in the author's browser, this runs wherever the page is
 * rendered, and only this decides what is served.
 */

/** What a reader is handed for a given source. */
const sanitizeHtml = (source: unknown): string =>
    typeof source === "string" ? renderMarkdown(source) : "";

describe("what a reader is handed", () => {
    it("keeps the formatting writing is for", () => {
        const out = sanitizeHtml("Hello **world** and *friends*");
        expect(out).toContain("<strong>world</strong>");
        expect(out).toContain("<em>friends</em>");
    });

    it("keeps headings, lists, tables, quotes and code", () => {
        const html =
            "<h2>Title</h2><ul><li>one</li></ul>"
            + "<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>"
            + "<blockquote>q</blockquote><pre><code>x = 1</code></pre><hr>";
        const out = sanitizeHtml(html);

        for (const tag of ["h2", "ul", "li", "table", "thead", "th", "td", "blockquote", "pre", "code"]) {
            expect(out).toContain(`<${tag}`);
        }
    });

    it("strips script tags and their contents", () => {
        const out = sanitizeHtml('<p>ok</p><script>fetch("/api/v1/admin/users")</script>');

        expect(out).not.toContain("<script");
        expect(out).not.toContain("fetch(");
        expect(out).toContain("<p>ok</p>");
    });

    it.each([
        ["img onerror", '<img src="x" onerror="alert(1)">', "onerror"],
        ["body onload", '<p onload="alert(1)">x</p>', "onload"],
        ["div onclick", '<div onclick="alert(1)">x</div>', "onclick"],
        ["span onmouseover", '<span onmouseover="alert(1)">x</span>', "onmouseover"],
        ["svg onbegin", '<svg><animate onbegin="alert(1)"/></svg>', "onbegin"],
    ])("strips the %s handler", (_name, dirty, handler) => {
        expect(sanitizeHtml(dirty)).not.toContain(handler);
    });

    it("strips javascript: and data: URLs from links", () => {
        const out = sanitizeHtml(
            '<a href="javascript:alert(1)">a</a>'
            + '<a href="data:text/html;base64,PHNjcmlwdD4=">b</a>',
        );

        expect(out).not.toContain("javascript:");
        expect(out).not.toContain("data:text/html");
    });

    it("keeps ordinary links and images", () => {
        const out = sanitizeHtml(
            '<a href="https://example.com" title="t" target="_blank" rel="noopener">x</a>'
            + '<img src="/uploads/a.png" alt="a">',
        );

        expect(out).toContain('href="https://example.com"');
        expect(out).toContain('target="_blank"');
        expect(out).toContain('src="/uploads/a.png"');
        expect(out).toContain('alt="a"');
    });

    it("strips iframes, forms and the elements that submit them", () => {
        const out = sanitizeHtml(
            '<iframe src="https://evil.test"></iframe>'
            + '<form action="/api/v1/admin"><input name="x"><button>go</button></form>'
            + '<embed src="x"><object data="x"></object>',
        );

        for (const tag of ["<iframe", "<form", "<button", "<embed", "<object"]) {
            expect(out).not.toContain(tag);
        }
        // `input` survives as a task list's tick box and nothing else: no
        // name to submit under, and no form left to submit to.
        expect(out).not.toContain('name="x"');
    });

    it("strips style tags and inline style attributes", () => {
        const out = sanitizeHtml(
            '<style>body{display:none}</style><p style="position:fixed;top:0">x</p>',
        );

        // A fixed-position overlay is a clickjacking primitive, and a <style>
        // block can hide or move anything on the page.
        expect(out).not.toContain("<style");
        expect(out).not.toContain("style=");
        expect(out).toContain("x");
    });

    it("drops data-* attributes", () => {
        const out = sanitizeHtml('<div data-controller="admin" data-x="1">x</div>');
        expect(out).not.toContain("data-controller");
        expect(out).not.toContain("data-x");
    });

    it("survives malformed and nested-payload markup", () => {
        // The classic "the sanitiser rewrote it into an attack" shapes.
        expect(sanitizeHtml("<scr<script>ipt>alert(1)</scr</script>ipt>")).not.toContain("<script");
        expect(sanitizeHtml('<<a href="javascript:alert(1)">')).not.toContain("javascript:");
        expect(sanitizeHtml("<p>unclosed")).toContain("unclosed");
    });

    it("returns an empty string for anything that is not a string", () => {
        // Callers pass request bodies straight in; a null must not throw
        // inside a write handler.
        expect(sanitizeHtml(null as never)).toBe("");
        expect(sanitizeHtml(undefined as never)).toBe("");
        expect(sanitizeHtml(42 as never)).toBe("");
        expect(sanitizeHtml({} as never)).toBe("");
        expect(sanitizeHtml("")).toBe("");
    });

    it("has nothing left to take on a second pass", () => {
        const once = sanitizeHtml('<p onclick="x()">a<script>b</script><em>c</em></p>');
        expect(once).not.toContain("onclick");
        expect(once).not.toContain("<script");
        expect(sanitizeHtml(once)).not.toContain("onclick");
    });
});
