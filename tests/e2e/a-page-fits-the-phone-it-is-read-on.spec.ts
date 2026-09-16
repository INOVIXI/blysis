import { test, expect } from "@playwright/test";

/**
 * Nothing on a public page is wider than the phone reading it.
 *
 * A single element that refuses to wrap does not just look wrong itself. The
 * document grows wider than the viewport, and a mobile browser answers that by
 * zooming the whole page out to fit - so every fixed overlay is then laid out
 * against the wider page rather than the screen. Measured on a 320px phone:
 * the announcement bar's text was one unbreakable 510px line, the document
 * became 554px, and the navigation drawer (`w-[85%] max-w-sm`) came out 384px
 * wide on a 320px screen, sitting over a page drawn at 58% scale.
 *
 * The cause was `truncate` on an inline `<span>`. On an inline box `overflow`
 * and `text-overflow` do nothing at all, so the only half of the utility that
 * applied was `white-space: nowrap`: the ellipsis never appeared and the line
 * never broke. It belongs on the block that holds the text.
 *
 * So the rule is measured on the page rather than read off the class names,
 * because the next version of this bug will wear different classes.
 */

test.use({ viewport: { width: 320, height: 658 }, isMobile: true, hasTouch: true });

/** The pages a visitor lands on, one per kind of layout. */
const PAGES = ["/tr", "/tr/blog", "/tr/store", "/tr/forum", "/en"];

for (const path of PAGES) {
    test(`${path} fits a 320px phone`, async ({ page }) => {
        await page.goto(path, { waitUntil: "networkidle" });
        // The announcement bar and the cookie notice both arrive after their
        // own fetch, and both were offenders.
        await page.waitForTimeout(1500);

        const report = await page.evaluate(() => {
            const viewport = document.documentElement.clientWidth;
            const offenders = [...document.querySelectorAll<HTMLElement>("*")]
                .filter((el) => {
                    const box = el.getBoundingClientRect();
                    return box.width > viewport + 1 || box.right > viewport + 1;
                })
                // The innermost one is the cause; its ancestors are victims.
                .filter((el) => ![...el.children].some((child) => {
                    const box = child.getBoundingClientRect();
                    return box.width > viewport + 1 || box.right > viewport + 1;
                }))
                .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().split(" ").slice(0, 3).join(".")}`);
            return { viewport, documentWidth: document.documentElement.scrollWidth, offenders };
        });

        expect(report.offenders, `wider than the ${report.viewport}px screen`).toEqual([]);
        expect(report.documentWidth).toBeLessThanOrEqual(report.viewport + 1);
    });
}
