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
 *
 * The navigation is found by its name, not as the bar across the top:
 * Vanguard draws it down the left edge. The restore carries the origin, as
 * every write from `page.request` must: without it the CSRF check refused it,
 * and each run left one more label translated, until the next spec found
 * three links named the same.
 */
test('a translated navbar label reaches readers of that language only', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await login(page);
    const before = await page.request.get('/api/v1/settings').then((r) => r.json());

    try {
        await page.goto('/en/admin/settings/navbar');
        await page.getByRole('button', { name: /^Translations \(0 of \d+\)$/ }).first().click();
        await page.getByRole('textbox', { name: 'Label, Türkçe' }).first().fill('Başlangıç noktası');
        await page.getByRole('button', { name: 'Save Navbar' }).click();
        await expect(page.getByText('Navbar saved')).toBeVisible();

        await page.goto('/tr');
        await expect(page.getByRole('navigation', { name: 'Ana menü' }).first()).toContainText('Başlangıç noktası');
        await page.goto('/de');
        const german = page.getByRole('navigation', { name: 'Hauptnavigation' }).first();
        await expect(german).toContainText('Startseite');
        await expect(german).not.toContainText('Başlangıç noktası');
    } finally {
        const restored = await page.request.patch('/api/v1/settings', {
            headers: { origin },
            data: { navbar_links: before.settings?.navbar_links ?? null },
        });
        expect(restored.ok(), 'the navbar is put back as it was').toBe(true);
    }
});
