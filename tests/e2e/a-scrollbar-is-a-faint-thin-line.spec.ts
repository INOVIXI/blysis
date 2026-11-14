import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * A scrollbar is a thin, faint line in the theme's muted colour, not a solid
 * grey slab beside the menu.
 *
 * The admin settings menu is the case that showed it: longer than the window,
 * it scrolled on a bar drawn in the muted text colour at full strength,
 * because the rule meant to fade it set `opacity` on the scrollbar thumb, which
 * a thumb ignores. The bar is checked on the scrolling menu itself and on the
 * page, in whatever theme and mode the run wears.
 */
async function scrollbarOf(page: Page, selector: string) {
    return page.evaluate((sel) => {
        const host = document.querySelector(sel);
        if (!host) return null;
        // The element that actually scrolls: the host, or the first of its
        // descendants whose own overflow scrolls.
        const scroller = [host, ...Array.from(host.querySelectorAll("*"))].find((el) =>
            ["auto", "scroll"].includes(getComputedStyle(el).overflowY),
        ) ?? host;
        const style = getComputedStyle(scroller);

        // `scrollbar-color` is two colours, thumb then track. Split at the
        // space between them, which is the one outside any parentheses.
        const value = style.scrollbarColor;
        let depth = 0;
        let cut = -1;
        for (let i = 0; i < value.length; i++) {
            if (value[i] === "(") depth++;
            else if (value[i] === ")") depth--;
            else if (value[i] === " " && depth === 0) { cut = i; break; }
        }
        const thumb = cut === -1 ? value : value.slice(0, cut);

        // How opaque the thumb is, read back from a canvas so every colour
        // syntax the browser may report comes out as one number.
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = thumb;
        ctx.fillRect(0, 0, 1, 1);
        const alpha = value === "auto" ? 255 : ctx.getImageData(0, 0, 1, 1).data[3];

        return { width: style.scrollbarWidth, color: value, alpha };
    }, selector);
}

test("a scrollbar is a faint thin line, in the menu and on the page", async ({ page }) => {
    await login(page);
    await page.goto("/en/admin/settings/general");

    for (const selector of ["aside", "html"]) {
        const bar = await scrollbarOf(page, selector);
        expect(bar, selector).not.toBeNull();
        expect(bar!.width, `${selector} scrollbar width`).toBe("thin");
        expect(bar!.color, `${selector} scrollbar colour`).not.toBe("auto");
        expect(bar!.alpha, `${selector} thumb opacity (0-255)`).toBeLessThan(200);
    }
});
