import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

/**
 * The languages screen lists every language the software ships, says how much
 * of the site each one holds, and which the site opens in.
 *
 * Read-only on purpose: the suite shares one database and every other spec
 * reads the site in the languages it offers. Saving is held by the route's
 * own tests; what only a served build answers is that the screen draws from
 * both endpoints it reads.
 */
test('the languages screen says how much of the site each language holds', async ({ page }) => {
    await login(page);
    await page.goto('/en/admin/languages');

    await expect(page.getByRole('checkbox', { name: 'Offer Türkçe' })).toBeChecked({ timeout: 15_000 });
    await expect(page.getByText(/^\d+ of \d+ strings$/).first()).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Open the site in English' })).toBeChecked();
    // The language the site opens in cannot be withdrawn from under it.
    await expect(page.getByRole('checkbox', { name: 'Offer English' })).toBeDisabled();
});
