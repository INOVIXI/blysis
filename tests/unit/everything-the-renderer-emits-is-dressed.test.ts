/**
 * Every element the renderer can produce has a rule that dresses it.
 *
 * `blysis-content` exists because seven screens rendered through `prose
 * dark:prose-invert`, class names that match nothing in a project with no
 * typography plugin, so headings came out at body size and lists lost their
 * markers. The same thing happens one element at a time as the renderer
 * learns to emit more: a `<details>` with no rule is a bare browser triangle
 * on an unboxed line, a `> [!NOTE]` is a plain `<div>`, a task list is a
 * checkbox with a bullet beside it, and a footnote section is a list of
 * paragraphs nobody separated from the article.
 *
 * So this asks the renderer itself what it can emit, rather than keeping a
 * list somebody has to remember to extend.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderMarkdown } from "@/core/lib/markdown";

const CSS = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

/** A document that exercises every construct the renderer supports. */
const EVERYTHING = [
    "# h1", "## h2", "### h3",
    "para **b** *i* ~~s~~ `c` <kbd>K</kbd> <sup>1</sup> <sub>2</sub>",
    "- a\n- b", "1. a", "- [x] done", "> quote", "> [!NOTE]\n> note",
    "```js\nx\n```", "| a |\n|---|\n| 1 |", "---",
    "[l](https://a.test)", "![i](https://a.test/i.png)",
    "<details>\n<summary>s</summary>\n\nb\n\n</details>",
    "note[^1]", "[^1]: text",
].join("\n\n");

const HTML = renderMarkdown(EVERYTHING);

/**
 * Elements a rule is not owed. `tbody`/`thead`/`tr` inherit from the cells,
 * `div` and `section` are containers whose own classes are checked below,
 * and `p`, `li`, `em`, `strong` already have theirs.
 */
const DRESSED_BY_SOMETHING_ELSE = new Set(["tbody", "thead", "tr", "div", "section"]);

describe("what `blysis-content` dresses", () => {
    it("exercises enough of the renderer to be worth asking", () => {
        expect(HTML.length).toBeGreaterThan(500);
    });

    it("has a rule for every tag the renderer emits", () => {
        const tags = [...new Set(Array.from(HTML.matchAll(/<([a-z0-9]+)[ >]/g), (m) => m[1]))];
        expect(tags.length).toBeGreaterThan(20);
        const undressed = tags
            .filter((tag) => !DRESSED_BY_SOMETHING_ELSE.has(tag))
            .filter((tag) => !new RegExp(`\\.blysis-content [^{,]*\\b${tag}\\b`).test(CSS))
            .sort();
        expect(undressed, "an element with no rule is a browser default on a themed page").toEqual([]);
    });

    /**
     * A container indents its children with margin, never with the `padding`
     * shorthand.
     *
     * `.blysis-content details > :not(summary) { padding: 0 1rem }` read as
     * "hold the content off the border", and what it also did was reset
     * `padding-left` on every child - including the `<ul>` whose own
     * `padding-left: 1.5rem` is where its bullets live. Measured at 1200px: a
     * list inside a collapsed section drew its bullets 17px from the panel
     * edge while the same list outside drew them at 24px, so the markers
     * crowded the border and sat left of the summary text above them.
     */
    it("indents a container's children without resetting their own padding", () => {
        const rule = CSS.slice(CSS.indexOf(".blysis-content details > :not(summary)"));
        expect(rule.slice(0, rule.indexOf("}"))).not.toMatch(/(^|[^-])\bpadding:/);
    });

    it("has a rule for every class the renderer emits", () => {
        const classes = [...new Set(
            Array.from(HTML.matchAll(/class="([^"]+)"/g), (m) => m[1]).flatMap((c) => c.split(" ")),
        )].filter((name) => name !== "sr-only" && !name.startsWith("language-"));
        expect(classes.length).toBeGreaterThan(2);
        const undressed = classes.filter((name) => !CSS.includes(`.${name}`)).sort();
        expect(undressed).toEqual([]);
    });
});
