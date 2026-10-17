/**
 * The primary navigation is one row at every width that shows it, and every
 * destination it holds is still one click away.
 *
 * The bar folds by count - eight links, then "More" - and a count knows
 * nothing about how long the words are. In Turkish the eight links and the
 * fold measure about 1000px, so on the Turkish site the row wrapped at every
 * width below 1536: two rows at 1024, 1280, 1366 and 1440, three at 768, all
 * inside a bar whose height is fixed, so the second row hung 9px (27px at
 * 768) below the header and over the page. English held until 1280 and
 * wrapped below it. A reader reported it from the demo as entries sliding
 * into each other.
 *
 * So the rule is measured where a reader meets it: what is visible on the
 * bar shares one line inside the header, and whatever the line could not
 * hold is behind the trailing menu rather than lost. Visibility is asked of
 * the page with a hit test, not read off class names, because an entry the
 * bar clips away is still in the DOM with every class it had.
 */
import { test, expect, type Page } from '@playwright/test';

/** Widths where the horizontal navigation is rendered (above the `sm` breakpoint). */
const DESKTOP_WIDTHS = [1920, 1536, 1440, 1366, 1280, 1024, 800];

async function open(page: Page, width: number) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/tr', { waitUntil: 'load' });
    await page.locator('header nav').first().waitFor();
    // The overflow trigger is decided once the bar has been laid out.
    await page.waitForTimeout(1200);
}

/**
 * The bar's entries: its direct children, and anything marked as one outside
 * it. Asked both ways so the spec measures the bar as it was before the fix
 * as well as after, instead of passing on a selector that finds nothing.
 */
const ENTRIES = 'header nav[aria-label] > a, header nav[aria-label] > div, header [data-nav-item]';

/** Entries a reader can see: the hit test at their centre lands on them. */
async function visibleEntries(page: Page) {
    return page.evaluate((selector) => {
        const header = document.querySelector('header')!.getBoundingClientRect();
        return [...new Set(document.querySelectorAll<HTMLElement>(selector))]
            .filter((el) => {
                const box = el.getBoundingClientRect();
                if (box.width === 0) return false;
                const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                return hit !== null && el.contains(hit);
            })
            .map((el) => {
                const box = el.getBoundingClientRect();
                return {
                    label: el.textContent!.trim(),
                    top: Math.round(box.top),
                    inside: box.top >= header.top - 0.5 && box.bottom <= header.bottom + 0.5,
                };
            });
    }, ENTRIES);
}

/** Every href the bar leads to: what is on it, plus what its menus hold once opened. */
async function reachable(page: Page) {
    const hrefs = new Set<string>();
    const add = async () => {
        for (const href of await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('header a[href]')]
            .filter((a) => {
                const box = a.getBoundingClientRect();
                if (box.width === 0) return false;
                const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                return hit !== null && a.contains(hit);
            })
            .map((a) => new URL(a.href).pathname))) hrefs.add(href);
    };
    await add();
    const triggers = page.locator('header nav[aria-label] button[aria-haspopup="menu"], header [data-nav-item] > button[aria-haspopup="menu"]');
    for (let i = 0; i < await triggers.count(); i++) {
        const trigger = triggers.nth(i);
        // A trigger clipped off the line is not one a reader can open.
        const seen = await trigger.evaluate((el) => {
            const box = el.getBoundingClientRect();
            if (box.width === 0) return false;
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            return hit !== null && el.contains(hit);
        });
        if (!seen) continue;
        // From the keyboard: a click also hovers, and hover opens the menu
        // the click then toggles shut.
        await trigger.focus();
        await page.keyboard.press('Enter');
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await add();
        await page.keyboard.press('Escape');
    }
    return hrefs;
}

test.describe('the primary navigation', () => {
    test('stays one row inside the header at every width that shows it', async ({ page }) => {
        const broken: string[] = [];
        for (const width of DESKTOP_WIDTHS) {
            await open(page, width);
            const entries = await visibleEntries(page);
            const rows = new Set(entries.map((e) => e.top)).size;
            const outside = entries.filter((e) => !e.inside).map((e) => e.label);
            if (rows > 1 || outside.length > 0) {
                broken.push(`${width}px: ${rows} rows, outside the header: ${outside.join(', ') || 'none'}`);
            }
        }
        expect(broken, `The navigation wrapped instead of folding:\n${broken.join('\n')}`).toEqual([]);
    });

    test('loses no destination when it folds', async ({ page }) => {
        await open(page, 1920);
        const wide = await reachable(page);
        expect(wide.size).toBeGreaterThan(5);

        for (const width of [1440, 1024, 800]) {
            await open(page, width);
            const narrow = await reachable(page);
            const lost = [...wide].filter((href) => !narrow.has(href));
            expect(lost, `${width}px lost: ${lost.join(', ')}`).toEqual([]);
        }
    });

    test('does not let the keyboard land on an entry the bar has hidden', async ({ page }) => {
        // An entry clipped off the line is still a link in the DOM. Left in
        // the tab order, focus would vanish onto something nobody can see.
        await open(page, 1024);
        const focusableButHidden = await page.evaluate((selector) => [...new Set(document.querySelectorAll<HTMLElement>(selector))]
            .filter((el) => {
                const box = el.getBoundingClientRect();
                if (box.width === 0) return false;
                const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                const seen = hit !== null && el.contains(hit);
                return !seen && el.closest('[inert]') === null;
            })
            .map((el) => el.textContent!.trim()), ENTRIES);
        expect(focusableButHidden).toEqual([]);
    });
});
