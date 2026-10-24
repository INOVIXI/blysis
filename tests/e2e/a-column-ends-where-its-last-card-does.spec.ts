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

test('the homepage columns end at their last card', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(DESKTOP);
    await page.goto('/tr', { waitUntil: 'load' });
    const drawn = await page.locator('[data-sidebar-layout]').waitFor({ timeout: 25_000 }).then(() => true, () => false);
    test.skip(!drawn, 'this homepage has no sidebar');
    await page.waitForTimeout(2_500);

    const overhang = await page.evaluate(() => {
        const out: Record<string, number> = {};
        for (const selector of ['[data-sidebar]', '[data-sidebar-main]']) {
            const column = document.querySelector(selector);
            if (!column) continue;
            const drawnChildren = [...column.querySelectorAll('[data-block]')]
                .filter((block) => block.getBoundingClientRect().height > 0);
            if (drawnChildren.length === 0) continue;
            const last = Math.max(...drawnChildren.map((block) => block.getBoundingClientRect().bottom));
            out[selector] = Math.round(column.getBoundingClientRect().bottom - last);
        }
        return out;
    });

    expect(Object.keys(overhang).length, 'no column drew a block').toBeGreaterThan(0);
    for (const [column, px] of Object.entries(overhang)) {
        expect(px, `${column} runs ${px}px past its last block`).toBeLessThanOrEqual(1);
    }
});
