/**
 * On a two-column page, both columns start at the same line.
 *
 * A section in the content column is a heading and then its cards; a widget
 * in the sidebar is a card with its heading inside. Left to themselves the
 * two columns begin at the same y, which puts every widget card a heading's
 * height above the cards it sits beside. It reads as crooked, and it is the
 * complaint that keeps coming back: the widget column floats.
 *
 * The homepage fixed it once, with `blysis-heading-spacer` and a comment naming
 * this file - which did not exist. So the rule was written down and never
 * held, and two more pages drifted out of line behind it. Measured at 1440px
 * on 2026-09-09: /wheel was 64px out (a wheel picker above the card) and
 * /help 44px (a section heading the sidebar had no answer for).
 *
 * Geometry rather than markup, because the thing under test is where the
 * boxes land, and a page may put them there any way it likes. A card is found
 * the way a reader finds one: the first box big enough to be one, with a
 * border and a background of its own.
 */
import { test, expect } from '@playwright/test';

/** Wide enough that the grid is two columns; below `lg` they stack. */
const DESKTOP = { width: 1440, height: 1200 };

/**
 * Public pages that may draw a sidebar. A page without one is skipped rather
 * than failed: which modules are installed is an operator's decision, and
 * this suite runs against whatever the box has.
 */
const PAGES = ['/tr', '/tr/blog', '/tr/wheel', '/tr/help'];

interface Tops {
    content: number | null;
    sidebar: number | null;
}

/**
 * Where each column's first card sits, both read in the same frame.
 *
 * Reading them one after the other was the first version and it was wrong:
 * the columns settle at different moments, so a skeleton's box in one and a
 * settled card in the other produced a difference that belonged to the clock
 * rather than to the layout.
 */
async function columnTops(page: import('@playwright/test').Page): Promise<Tops> {
    return page.evaluate(() => {
        const firstCard = (selector: string): number | null => {
            const root = document.querySelector(selector);
            if (!root) return null;
            for (const el of root.querySelectorAll('*')) {
                const box = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                // A card is a panel a reader sees as one thing, and in this
                // design what makes one is its rounded corner. Requiring a
                // border over a filled background missed the homepage's promo
                // panel, whose fill is on a child inside `overflow-hidden`, so
                // this read the card *below* it and reported the two columns
                // 195px apart when both start at 200.
                const boxed = style.borderRadius !== '0px'
                    || (style.borderTopWidth !== '0px'
                        && style.backgroundColor !== 'rgba(0, 0, 0, 0)');
                if (box.height > 40 && boxed) return Math.round(box.top);
            }
            return null;
        };
        return {
            content: firstCard('[data-sidebar-main]'),
            sidebar: firstCard('[data-sidebar]'),
        };
    });
}

/** The same reading twice in a row, which is what "settled" means here. */
async function settledTops(page: import('@playwright/test').Page): Promise<Tops> {
    let previous: Tops = { content: null, sidebar: null };
    for (let attempt = 0; attempt < 20; attempt++) {
        await page.waitForTimeout(500);
        const now = await columnTops(page);
        if (now.content !== null && now.sidebar !== null
            && now.content === previous.content && now.sidebar === previous.sidebar) {
            return now;
        }
        previous = now;
    }
    return previous;
}

test.describe('a page with a sidebar', () => {
    for (const path of PAGES) {
        test(`starts both of its columns on the same line: ${path}`, async ({ page }) => {
            test.setTimeout(90_000);
            await page.setViewportSize(DESKTOP);
            await page.goto(path, { waitUntil: 'domcontentloaded' });

            const layout = page.locator('[data-sidebar-layout]');
            const drawn = await layout.waitFor({ timeout: 25_000 }).then(() => true, () => false);
            test.skip(!drawn, 'this page has no sidebar');

            const { content, sidebar } = await settledTops(page);
            test.skip(content === null || sidebar === null, 'a column drew no card');

            expect(
                Math.abs((content as number) - (sidebar as number)),
                `${path}: content card at ${content}, sidebar card at ${sidebar}`,
            ).toBeLessThanOrEqual(1);
        });
    }
});
