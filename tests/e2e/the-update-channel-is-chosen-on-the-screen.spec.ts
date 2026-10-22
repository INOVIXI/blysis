/**
 * The release channel is chosen on the update screen, and stays chosen.
 *
 * The choice shows the moment it is made. The radios follow the state the
 * screen loaded, and while that waited for the save the dot jumped back to
 * the old channel and then forward again; Playwright's `check` is what
 * notices, because it asks whether the click changed the control.
 *
 * The spec puts the channel back to stable on the way out, because the
 * other specs share this database.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

test('the release channel is chosen on the update screen, and stays chosen', async ({ page }) => {
    await login(page);
    await page.goto('/tr/admin/updates');

    const group = page.getByRole('radiogroup');
    await group.waitFor();
    const stable = group.locator('input[type="radio"][value="stable"]');
    const beta = group.locator('input[type="radio"][value="beta"]');
    await expect(stable).toBeChecked();

    const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/admin/updates') && r.request().method() === 'PATCH');
    await beta.check();
    expect((await saved).status()).toBe(200);

    await page.reload();
    await group.waitFor();
    await expect(beta).toBeChecked();

    const back = page.waitForResponse((r) => r.url().endsWith('/api/v1/admin/updates') && r.request().method() === 'PATCH');
    await stable.check();
    expect((await back).status()).toBe(200);
    await page.reload();
    await expect(stable).toBeChecked();
});
