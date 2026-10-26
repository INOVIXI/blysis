/**
 * A menu on the bar that hovering opened stays open while the pointer moves
 * down into it.
 *
 * The bar's menus hang from the bar rather than from their trigger, because
 * the nav clips whatever it holds. That left a strip between the trigger's
 * bottom edge and the panel's top that belonged to neither, and moving the
 * pointer across it left the item, which shut the menu before the pointer
 * reached a link. A reader reported it as the store's submenu vanishing the
 * moment they reached for it.
 *
 * The pointer is moved in small steps, as a hand moves it, so it passes
 * through every pixel of the way down rather than jumping over the strip.
 *
 * The menu tried is the first a reader can reach. A bar narrower than its
 * links clips a menu that sits late in the line onto a second line nobody
 * sees and makes it inert; what it holds is offered by the trailing menu
 * outside the line instead. Kite's bar is such a bar, and taking the first
 * menu inside the line hovered one the reader cannot.
 */
import { test, expect } from '@playwright/test';
import { skipUnlessTheThemeDrawsABar } from './helpers/bar';

test('a menu on the bar stays open while the pointer moves into it', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto('/tr', { waitUntil: 'load' });
    await skipUnlessTheThemeDrawsABar(page);
    await page.locator('header nav').first().waitFor();
    // The fold is decided once the bar has been laid out.
    await page.waitForTimeout(1200);

    const triggers = page.locator('header [data-nav-item]:not([inert]) > button[aria-haspopup="menu"]');
    // A site with no menu on the bar would pass this for nothing.
    expect(await triggers.count()).toBeGreaterThan(0);

    const trigger = triggers.first();
    const item = trigger.locator('..');
    const from = (await trigger.boundingBox())!;
    const x = from.x + 16;
    await page.mouse.move(x, from.y + from.height / 2);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const link = item.locator('a[href]').first();
    const to = (await link.boundingBox())!;
    await page.mouse.move(x, to.y + to.height / 2, { steps: 24 });

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(link).toBeVisible();
});
