/**
 * A chosen radio and a ticked checkbox look chosen in dark mode too.
 *
 * Both primitives draw their state with their own background: the radio's
 * dot and the checkbox's fill are `bg-primary` on a native input with its
 * appearance turned off. The dark stylesheet repaints every native input
 * with the page's background, for inputs that bring no styling of their own,
 * and that rule reached these two as well, so in dark mode a chosen radio
 * was an empty circle and a ticked box an outline with a tick floating in
 * it. Nothing on the update channel card said which channel the site was on.
 *
 * Measured as the browser paints it: the computed background of the chosen
 * control, against the theme's primary colour and the page's own.
 */
import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers/login';

async function paint(page: Page, selector: string) {
    return page.evaluate((sel) => {
        const probe = document.createElement('span');
        probe.className = 'bg-primary';
        document.body.appendChild(probe);
        const primary = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const el = document.querySelector<HTMLInputElement>(sel);
        return {
            found: el !== null,
            checked: el?.checked ?? false,
            background: el ? getComputedStyle(el).backgroundColor : '',
            primary,
            page: getComputedStyle(document.documentElement).backgroundColor,
        };
    }, selector);
}

test('a chosen radio and a ticked checkbox look chosen in dark mode', async ({ page }) => {
    await login(page);
    await page.goto('/tr/admin/settings/alerting');
    await page.locator('input[type="radio"]').first().waitFor();

    // Ticked on the screen only; nothing is saved.
    const box = page.locator('input#enabled');
    if (!(await box.isChecked())) await box.check();

    // The controls ease between colours, and a reading taken mid-way is the
    // light one. Off, the reading is the colour the mode settles on.
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    await page.evaluate(() => document.documentElement.setAttribute('data-mode', 'dark'));

    for (const selector of ['input[type="radio"]:checked', 'input#enabled']) {
        const seen = await paint(page, selector);
        expect(seen.found, selector).toBe(true);
        expect(seen.checked, selector).toBe(true);
        expect(seen.background, `${selector} is painted as chosen`).toBe(seen.primary);
        expect(seen.background, `${selector} stands out from the page`).not.toBe(seen.page);
    }
});
