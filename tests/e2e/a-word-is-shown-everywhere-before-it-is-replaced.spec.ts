import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

/**
 * The translation editor shows a string once, whoever ships it, and shows
 * every string a word is in before it replaces any of them.
 *
 * Read-only on purpose: the suite shares one database, so nothing here is
 * saved. The writes are covered by the endpoint's own tests.
 */
test.describe('the words of the site', () => {
    test('a string is one line, and says who says it', async ({ page }) => {
        await login(page);
        await page.goto('/en/admin/translations');
        await page.getByRole('textbox', { name: /Search a key or what it says/i }).fill('store.title');

        const line = page.getByText('store.title', { exact: true });
        await expect(line).toHaveCount(1, { timeout: 15_000 });
        await expect(page.getByText(/^Said by /).first()).toBeVisible();
    });

    test('a replacement is previewed before anything is written', async ({ page }) => {
        await login(page);
        await page.goto('/en/admin/translations/replace');
        await page.getByLabel('Find').fill('Store');
        await page.getByLabel('Replace with').fill('Market');
        await page.getByLabel('Working in').selectOption('en');
        await page.getByRole('button', { name: 'Show changes' }).click();

        await expect(page.getByText(/Market/).first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: /^Change \d+ strings?$/ })).toBeEnabled();
    });
});
