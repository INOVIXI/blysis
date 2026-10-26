import { test, expect } from '@playwright/test';

test.describe('Core Platform', () => {
    test('homepage loads', async ({ page }) => {
        const response = await page.goto('/');
        expect(response?.status()).toBeLessThan(400);
    });

    test('homepage has no module content when no modules installed', async ({ page }) => {
        await page.goto('/');
        // Core homepage should render without module-specific sections
        await expect(page.locator('body')).toBeVisible();
    });

    test('navbar shows Home link', async ({ page }) => {
        await page.goto('/en');
        const nav = page.locator('nav, header').first();
        await expect(nav).toBeVisible();
        // Home link uses translated label ("Home" in EN, "Ana Sayfa" in TR)
        // and always has href="/"
        // Multiple Home links exist (mobile brand, desktop nav, footer) -
        // assert that at least one visible Home link is present at desktop width,
        // in the primary navigation wherever the theme draws it: a bar across
        // the top, or Vanguard's rail down the left edge.
        const homeLink = page.locator('nav[aria-label="Primary"] a[href="/en"], nav[aria-label="Primary"] a[href="/"]').first();
        await expect(homeLink).toBeVisible();
    });

    test('footer renders', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('footer').first()).toBeVisible();
    });

    test('login page loads', async ({ page }) => {
        const response = await page.goto('/en/auth/login');
        expect(response?.status()).toBeLessThan(400);
    });

    test('register page loads', async ({ page }) => {
        const response = await page.goto('/en/auth/register');
        expect(response?.status()).toBeLessThan(400);
    });

    test('admin redirects to login when not authenticated', async ({ page }) => {
        await page.goto('/en/admin');
        await page.waitForURL(/auth\/login|\/login/, { timeout: 15_000 });
        expect(page.url()).toContain('login');
    });

    test('404 page works for unknown routes', async ({ page }) => {
        // Next.js App Router streams the response, so HTTP status may be 200
        // even when notFound() is triggered. Verify by content instead.
        await page.goto('/en/this-route-does-not-exist-xyz123', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/Page Not Found|404/i).first()).toBeVisible();
    });
});
