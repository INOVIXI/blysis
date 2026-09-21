/**
 * Two controls that go different places do not read the same.
 *
 * A screen reader offers the controls on a page as a list of names. Two that
 * read identically and lead somewhere different is a coin toss, and the
 * reader has nothing else to go on: an icon has no text, and a link that says
 * "See all" does not say all of what.
 *
 * Found by a tool doing exactly what a reader does. A script asking for the
 * button called "Kapat" got the announcement strip's rather than the
 * dialog's, because `dismiss` and `close` are two words in English and one in
 * Turkish. Sweeping every page for the same shape on 2026-09-21 turned up 46
 * of them across 145 pages, and two were worth more than the rest:
 *
 *   /admin/modules  - a cog per module card, every one of them named
 *                     "Settings". Ninety modules, ninety identical names.
 *   /admin          - three "See all" links, to forum topics, to tickets and
 *                     to orders.
 *
 * The rest are a row's own actions - Edit, View, repeated down a table - and
 * are left alone: a table row is read as a row, and its cells are the
 * context. That is the line this test draws, and NAMED_BY_THEIR_ROW is where
 * it is written down.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

/**
 * Read a page the way an assistive technology does: every control that can be
 * reached, by the name it would be announced under.
 */
const CLASHES = `(() => {
    const reachable = Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
        .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        });

    const byName = new Map();
    for (const el of reachable) {
        const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!name || name.length > 40) continue;
        // A row's own actions are read with the row. Anything inside a table
        // carries that context already.
        if (el.closest('table')) continue;
        const goes = el.tagName === 'A' ? (el.getAttribute('href') || '') : 'press';
        if (!byName.has(name)) byName.set(name, new Set());
        byName.get(name).add(el.tagName + '|' + goes);
    }

    return [...byName.entries()]
        // One name pointing at one place is a repeat, not a clash: a card and
        // the title inside it may both link to the same article.
        .filter(([, places]) => places.size > 1)
        .map(([name, places]) => name + ' -> ' + [...places].slice(0, 3).join(', '));
})()`;

/** Screens whose repeated controls are a row's, and read as one. */
const NAMED_BY_THEIR_ROW = 'a table row is read with its cells, so Edit and View repeated down one are not ambiguous';

test.describe('a control on a screen full of them', () => {
    test('says which one it is, on the module list', async ({ page }) => {
        await login(page);
        await page.goto('/tr/admin/modules');
        await page.waitForTimeout(2500);
        expect(
            await page.evaluate<string[]>(CLASHES),
            `each module card carries a cog, and every one of them was named "Settings". ${NAMED_BY_THEIR_ROW}`,
        ).toEqual([]);
    });

    test('says which one it is, on the dashboard', async ({ page }) => {
        await login(page);
        await page.goto('/tr/admin');
        await page.waitForTimeout(2500);
        expect(
            await page.evaluate<string[]>(CLASHES),
            'the dashboard draws a card per section, each with a link to the rest of it',
        ).toEqual([]);
    });

    /**
     * The same shape on the pages a visitor meets, where it matters most: a
     * list of cards, each with the same control on it. None of these is a
     * table, so none of them has a row to be read with.
     */
    for (const [what, path] of [
        ['a release and the note that explains it', '/tr/changelog'],
        ['a file and how to use it', '/tr/downloads'],
        ['a rank and the way to buy it', '/tr/store/vip'],
    ] as const) {
        test(`says which one it is, for ${what}`, async ({ page }) => {
            await page.goto(path);
            await page.waitForTimeout(2500);
            expect(await page.evaluate<string[]>(CLASHES), what).toEqual([]);
        });
    }
});
