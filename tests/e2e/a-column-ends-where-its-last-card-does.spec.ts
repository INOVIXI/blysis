/**
 * A column of blocks ends where the last one it drew does.
 *
 * Every block on the homepage sits in a box of its own, and a block with
 * nothing to show leaves that box empty and hidden. Spacing the column with
 * `space-y` puts a margin under every child but the last, and the last child
 * was a hidden box: the last card that drew kept its margin, and the column
 * ran 20px past it into the space above the footer.
 *
 * Geometry rather than markup, for the reason the column-start spec gives:
 * what is under test is where the boxes land.
 */
import { test, expect } from '@playwright/test';

const DESKTOP = { width: 1440, height: 1200 };

test('the homepage row ends at its lowest card', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(DESKTOP);
    await page.goto('/tr', { waitUntil: 'load' });
    const drawn = await page.locator('[data-sidebar-layout]').waitFor({ timeout: 25_000 }).then(() => true, () => false);
    test.skip(!drawn, 'this homepage has no sidebar');
    await page.waitForTimeout(2_500);

    // The row, not each column: a grid stretches the shorter column to the
    // taller one, so only the row's own bottom says whether anything ran on.
    const overhang = await page.evaluate(() => {
        const row = document.querySelector('[data-sidebar-layout]');
        if (!row) return null;
        const drawnBlocks = [...row.querySelectorAll('[data-block]')]
            .filter((block) => block.getBoundingClientRect().height > 0);
        if (drawnBlocks.length === 0) return null;
        const lowest = Math.max(...drawnBlocks.map((block) => block.getBoundingClientRect().bottom));
        return Math.round(row.getBoundingClientRect().bottom - lowest);
    });

    expect(overhang, 'the row drew no block').not.toBeNull();
    expect(overhang, `the row runs ${overhang}px past its lowest block`).toBeLessThanOrEqual(1);
});
