import { test, type Page } from '@playwright/test';

/**
 * Skips a spec about the bar across the top of the page when the theme draws
 * its navigation somewhere else.
 *
 * Vanguard puts the navigation down the left edge: a column that shows every
 * link, so it never folds, and opens a group in place rather than as a menu
 * on hover. A rule about a row and the menus hanging from it has nothing
 * there to hold, and these specs failed under it for looking in a `<header>`
 * that holds no navigation.
 *
 * The primary navigation must still be on the page, wherever it is: a theme
 * that drew none fails here instead of skipping. A page's own header, inside
 * `<main>`, is not the bar, though it may hold a trail of links.
 */
export async function skipUnlessTheThemeDrawsABar(page: Page) {
    await page.locator('nav[aria-label]').first().waitFor();
    const bars = await page.locator('header:not(main header) nav[aria-label]').count();
    test.skip(bars === 0, 'this theme draws its navigation as a rail, not a bar');
}
