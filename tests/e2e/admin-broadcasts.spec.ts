import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

test.describe('Admin broadcasts', () => {
    test('opens composer, fills subject and body, closes without sending', async ({ page }) => {
        await login(page);

        const response = await page.goto('/en/admin/broadcasts');
        expect(response?.status(), 'broadcasts HTTP status').toBeLessThan(400);

        // The h1 is `sidebar_broadcasts` - "Broadcasts" in en. "Email
        // Broadcasts" is the settings-index card label, not this page.
        const heading = page.getByRole('heading', { name: /^Broadcasts$/i }).first();
        await expect(heading).toBeVisible();

        // The composer is a screen at `?form=new`, so the control that opens
        // it is a link rather than a button. It reads `common_new` - "New".
        const compose = page.getByRole('link', { name: /^New$/i }).first();
        await expect(compose).toBeVisible();
        await compose.click();

        await expect(
            page.getByRole('heading', { name: /New Broadcast/i }).first(),
        ).toBeVisible();
        await expect(page, 'the composer has an address of its own').toHaveURL(/form=new/);

        // Fill subject
        const subjectInput = page
            .locator('input[placeholder="Important update"]')
            .first();
        await expect(subjectInput).toBeVisible();
        await subjectInput.fill('E2E Test Subject');

        // Rich text editor body - find its editable region
        const body = page.locator('[contenteditable="true"]').first();
        if (await body.count()) {
            await body.click();
            await page.keyboard.type('Test body content');
        }

        // Leave without sending. The composer is its own screen, so what
        // leaves it is the header's back control - `common_back`.
        await page.getByRole('button', { name: /^Back$/i }).first().click();
        await expect(page.getByRole('heading', { name: /New Broadcast/i })).toHaveCount(0);

        // Back on the list, at the address the list has.
        await expect(heading).toBeVisible();
        await expect(page).not.toHaveURL(/form=/);
    });
});
