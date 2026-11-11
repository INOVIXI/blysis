import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

/**
 * A navbar label the operator translates in the panel is what a reader of
 * that language finds in the bar, and every other language keeps what it had.
 *
 * The label had one value, shown in every language. The editor now opens the
 * site's languages beneath each label; the first link is the way home, which
 * carries the bar's own translation key, so a German reader, for whom the
 * operator wrote nothing, still reads the bar's German word. The spec puts
 * the bar back as it found it.
 */
test('a translated navbar label reaches readers of that language only', async ({ page }) => {
    await login(page);
    const before = await page.request.get('/api/v1/settings').then((r) => r.json());

    try {
        await page.goto('/en/admin/settings/navbar');
        await page.getByRole('button', { name: /^Translations \(0 of \d+\)$/ }).first().click();
        await page.getByRole('textbox', { name: 'Label, Türkçe' }).first().fill('Başlangıç noktası');
        await page.getByRole('button', { name: 'Save Navbar' }).click();
        await expect(page.getByText('Navbar saved')).toBeVisible();

        const nav = page.locator('header nav').first();
        await page.goto('/tr');
        await expect(nav).toContainText('Başlangıç noktası');
        await page.goto('/de');
        await expect(nav).toContainText('Startseite');
        await expect(nav).not.toContainText('Başlangıç noktası');
    } finally {
        await page.request.patch('/api/v1/settings', {
            data: { navbar_links: before.settings?.navbar_links ?? null },
        });
    }
});
