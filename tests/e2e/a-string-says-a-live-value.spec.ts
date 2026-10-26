import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

/**
 * A string the site wrote can say a live value, picked in the editor and
 * read on the page with the value in its place.
 *
 * The unit tests hold the filling and the check; this holds the road between
 * them, which only a served build walks: the picker puts the token in the
 * box, the save is accepted, and the catalogue a page is given says the
 * site's name where the token was, beside a count the code still passes. The
 * string is the translation screen's own description, so no other spec reads
 * it, and it is put back before the test ends.
 */
const NAMESPACE = 'admin';
const KEY = 'translations_description';
const OTHERS = ['az', 'de', 'en', 'es', 'et', 'fr', 'it', 'pl', 'pt', 'ru', 'zh'];

test('a string names the site and a page reads the name', async ({ page }) => {
    await login(page);
    try {
        const listed = await page.request.get('/api/v1/admin/placeholders');
        expect(listed.ok()).toBe(true);
        const { placeholders } = await listed.json() as { placeholders: { name: string; value: string | number | null }[] };
        const siteName = placeholders.find((p) => p.name === 'site.name')?.value;
        expect(typeof siteName).toBe('string');

        await page.goto('/en/admin/translations');
        await page.getByLabel('Working in').selectOption('tr');
        await page.getByRole('textbox', { name: /Search a key or what it says/i }).fill(`${NAMESPACE}.${KEY}`);
        await expect(page.getByText(`${NAMESPACE}.${KEY}`, { exact: true })).toHaveCount(1, { timeout: 15_000 });

        const box = page.getByRole('textbox', { name: /Türkçe/ });
        await box.click();
        await box.press('Control+End');
        await box.pressSequentially(' - ');
        await page.getByRole('button', { name: 'Insert placeholder' }).click();
        await page.getByRole('list', { name: 'The placeholders this site answers' }).getByRole('button', { name: /Site name/ }).click();
        await expect(box).toHaveValue(/ - \{site\.name\}$/);
        await expect(page.getByText(`Visitors read: `, { exact: false })).toContainText(` - ${siteName}`);

        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('Saved.')).toBeVisible();

        await page.goto('/tr/admin/translations');
        const description = page.getByText(/Sitenin sunduğu her dilde toplam \d/);
        await expect(description).toContainText(` - ${siteName}`, { timeout: 15_000 });
        await expect(description).not.toContainText('{site.name}');
    } finally {
        // The string as it shipped, and what the edit asked of the other
        // languages answered. A write without an Origin is turned away by
        // the CSRF gate, so each says where it comes from.
        const origin = new URL(page.url()).origin;
        const restored = await page.request.delete('/api/v1/admin/translations', {
            headers: { origin },
            data: { namespace: NAMESPACE, key: KEY, locale: 'tr' },
        });
        expect([200, 404]).toContain(restored.status());
        for (const locale of OTHERS) {
            const answered = await page.request.post('/api/v1/admin/translations/flags', {
                headers: { origin },
                data: { namespace: NAMESPACE, key: KEY, locale, reason: 'translate' },
            });
            expect([200, 404], locale).toContain(answered.status());
        }
    }
});
