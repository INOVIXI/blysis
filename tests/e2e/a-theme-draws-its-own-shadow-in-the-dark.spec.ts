/**
 * A theme's shadow on a button holds in dark mode.
 *
 * The dark stylesheet deepens Tailwind's small and large shadows, which are
 * a tenth of black and vanish on a dark page. It did so with `!important`,
 * so in dark mode it also beat every theme that draws a shadow of its own:
 * Quarry's buttons stand on a darker edge of their colour, and the filled
 * ones, which carry `shadow-sm`, lost it in dark mode only. The primary
 * button in the bar and in the hero were flat where every other button
 * stood on its edge.
 *
 * Measured as the browser paints it: a theme rule beside the utility, and
 * the utility alone, both in dark mode.
 */
import { test, expect } from '@playwright/test';

test('a theme draws its own button shadow in dark mode, and a plain one is still deepened', async ({ page }) => {
    await page.goto('/tr');
    // Unlayered, as a theme's stylesheet is.
    await page.addStyleTag({ content: '.probe-theme .blysis-button { box-shadow: 0 4px 0 rgb(1, 2, 3); }' });

    // The mode is set in the same synchronous step that reads the styles: a
    // light site's provider writes its own mode back while it hydrates.
    const seen = await page.evaluate(() => {
        document.documentElement.setAttribute('data-mode', 'dark');
        const host = document.createElement('div');
        host.className = 'probe-theme';
        host.innerHTML = '<span class="blysis-button bg-primary shadow-sm">a</span><span class="shadow-sm">b</span><span class="shadow-lg">c</span>';
        document.body.appendChild(host);
        const [themed, small, large] = [...host.children].map((el) => getComputedStyle(el).boxShadow);
        host.remove();
        return { themed, small, large };
    });

    expect(seen.themed).toBe('rgb(1, 2, 3) 0px 4px 0px 0px');
    expect(seen.small).toContain('rgba(0, 0, 0, 0.3) 0px 1px 2px 0px');
    expect(seen.large).toContain('rgba(0, 0, 0, 0.4) 0px 4px 12px 0px');
});
