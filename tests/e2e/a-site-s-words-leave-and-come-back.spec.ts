import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

/**
 * The site's words leave as a file and come back in through the import
 * screen, which says what the file would change before anything is written.
 *
 * Read-only on purpose: the file is this site's own, so reading it back
 * changes nothing and the screen says so, and nothing is applied. The writes
 * are held by the endpoint's own tests; this holds the download and the
 * picker, which only a browser exercises.
 */
test('a file of the site\'s words comes back changing nothing on the site it left', async ({ page }) => {
    await login(page);
    await page.goto('/en/admin/translations');

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('link', { name: 'Export' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^site-words-\d{4}-\d{2}-\d{2}\.json$/);
    const saved = await download.path();

    await page.goto('/en/admin/translations/import');
    await page.getByLabel('Choose a file').setInputFiles(saved);
    await expect(page.getByText('This file changes nothing on this site.')).toBeVisible({ timeout: 15_000 });
});
