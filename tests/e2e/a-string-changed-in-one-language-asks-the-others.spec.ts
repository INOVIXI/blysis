import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

/**
 * A string changed in one language asks the others to follow, and the change
 * can be taken back from its history.
 *
 * The endpoint's own tests hold the writes; this holds what only a database
 * can answer, the filter that finds what awaits translation, and the screen
 * that offers the answers. The suite shares one database, so the string is
 * one only the editor's own history panel says, and everything written is
 * taken back before the test ends.
 */
const KEY = 'admin.translations_historyEmpty';
const LOCALES = ['az', 'de', 'en', 'es', 'et', 'fr', 'it', 'pl', 'pt', 'ru', 'zh'];

test.describe('a string changed in one language', () => {
    test('is awaited in another, and taken back from its history', async ({ page }) => {
        await login(page);
        let putBack = false;
        try {
            await page.goto('/en/admin/translations');
            await page.getByLabel('Working in').selectOption('tr');
            await page.getByRole('textbox', { name: /Search a key or what it says/i }).fill(KEY);
            await expect(page.getByText(KEY, { exact: true })).toHaveCount(1, { timeout: 15_000 });

            const box = page.getByRole('textbox', { name: /Türkçe/ });
            const before = await box.inputValue();
            await box.fill(`${before} (e2e)`);
            await page.getByRole('button', { name: 'Save' }).click();
            await expect(page.getByText('Saved.')).toBeVisible();

            await page.getByLabel('Working in').selectOption('de');
            await page.getByLabel('Show').selectOption('awaiting');
            await expect(page.getByText(KEY, { exact: true })).toHaveCount(1, { timeout: 15_000 });
            await expect(page.getByText('Awaiting translation', { exact: true })).toBeVisible();
            await page.getByRole('button', { name: 'Still right' }).click();
            await expect(page.getByText('Awaiting translation', { exact: true })).toHaveCount(0);

            await page.getByLabel('Show').selectOption('all');
            await page.getByLabel('Working in').selectOption('tr');
            await expect(page.getByText(KEY, { exact: true })).toHaveCount(1, { timeout: 15_000 });
            await page.getByRole('button', { name: 'History' }).click();
            await page.getByRole('button', { name: 'Undo' }).first().click();
            await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
            await expect(page.getByText('Put back.')).toBeVisible();
            await expect(box).toHaveValue(before);
            putBack = true;
        } finally {
            // The string as it was, and whatever the edit asked of the other
            // languages answered, so the next run, and every other spec,
            // finds it untouched. A write without an Origin is turned away by
            // the CSRF gate, so each says where it comes from.
            const origin = new URL(page.url()).origin;
            if (!putBack) {
                await page.request.delete('/api/v1/admin/translations', {
                    headers: { origin },
                    data: { namespace: 'admin', key: 'translations_historyEmpty', locale: 'tr' },
                });
            }
            for (const locale of LOCALES) {
                const answered = await page.request.post('/api/v1/admin/translations/flags', {
                    headers: { origin },
                    data: { namespace: 'admin', key: 'translations_historyEmpty', locale, reason: 'translate' },
                });
                // Answered, or already answered on the screen; anything else
                // is a cleanup that did not happen.
                expect([200, 404], locale).toContain(answered.status());
            }
        }
    });
});
