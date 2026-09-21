/**
 * The pointer over a control that can be pressed.
 *
 * Tailwind v4's preflight gives `button` a `cursor: default`, which is a
 * deliberate change from v3 and the right default for a reset - a button is
 * not a link. It is the wrong default for this product, where every button is
 * something a visitor is meant to click, and it applied to all of them:
 * measured against the running site, the buttons on a help article reported
 * `default` rather than `pointer`.
 *
 * The shared `Button` component carries `cursor-pointer` in its class list, so
 * anything built from it was fine and the gap was invisible in the places
 * people look first. Everywhere else - 107 raw `<button>` tags across 64 files
 * at the time of writing - the arrow stayed, and a visitor reads an arrow as
 * "this is not for me".
 *
 * One rule rather than 107 edits, because the next raw button somebody writes
 * would otherwise start out wrong again. `:not(:disabled)` keeps the arrow
 * where an arrow is correct: a control that cannot be pressed should not
 * pretend otherwise.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

describe("a control that can be pressed", () => {
    it("is given a pointer, since the framework's reset takes it away", () => {
        expect(css).toMatch(/button:not\(:disabled\)/);
        expect(css).toMatch(/cursor:\s*pointer/);
    });

    it("covers the things that behave like a button without being one", () => {
        // A div carrying role="button" is a button to a screen reader and to
        // anybody using it, so it should read the same to a mouse.
        expect(css).toContain('[role="button"]');
    });

    it("leaves the arrow where the control cannot be pressed", () => {
        // `:not(:disabled)` and the aria equivalent, so a disabled control
        // keeps saying so with the cursor as well as with its opacity.
        expect(css).toMatch(/\[role="button"\]:not\(\[aria-disabled="true"\]\)/);
    });
});

/**
 * One focus indicator, not two.
 *
 * `globals.css` draws a focus ring for everything that has none of its own -
 * a bare link, an input somebody wrote without reaching for `Input`. That is
 * right, and it should stay.
 *
 * It was written outside any layer, and an unlayered rule beats every layered
 * one however specific the layered one is. So `focus-visible:outline-none`,
 * which `buttonClassName` carries precisely so a button can draw its own ring
 * instead, never applied: a focused button wore the global 2px outline at 2px
 * offset *and* its own ring at 4px, two blue lines with a white gap between
 * them. Measured on the popup's close button, which a dialog focuses the
 * moment it opens, so a visitor who had clicked nothing saw it on arrival.
 *
 * In `@layer base` it is still the fallback for everything that declares
 * nothing, and a component that declares its own now replaces it.
 */
describe("the focus ring a control has not asked for", () => {
    const focusRule = /:focus-visible\s*\{[^}]*outline:/;

    it("is drawn, for everything that draws none of its own", () => {
        expect(css).toMatch(focusRule);
    });

    it("is not drawn on a box the keyboard cannot reach", () => {
        // A dialog takes focus itself so Tab has an edge and a screen reader
        // lands on it. It carries tabindex="-1", so nobody ever tabbed there
        // and a ring around the whole popup says nothing about where they are.
        expect(css).toMatch(/\[tabindex="-1"\]:focus-visible\s*\{\s*outline:\s*none/);
    });

    it("is in a layer, so a control that draws its own replaces it", () => {
        // Find the rule, then walk back to see which layer block holds it.
        const at = css.search(focusRule);
        expect(at, "no global focus rule found at all").toBeGreaterThan(-1);

        const before = css.slice(0, at);
        const opened = (before.match(/@layer[^{]*\{/g) ?? []).length;
        const closedBraces = (before.match(/\}/g) ?? []).length;
        const openedBraces = (before.match(/\{/g) ?? []).length;

        expect(
            opened > 0 && openedBraces > closedBraces,
            "the global :focus-visible rule sits outside @layer, so it wins over " +
            "every utility and a component cannot replace it with its own ring",
        ).toBe(true);
    });
});
