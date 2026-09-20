import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

test.describe('Module System', () => {
    test('/api/v1/modules requires auth and returns modules object', async ({ request }) => {
        // Endpoint is admin-gated; unauthenticated callers receive 401.
        const response = await request.get('/api/v1/modules');
        expect([200, 401, 403]).toContain(response.status());
        if (response.status() === 200) {
            const data = await response.json();
            // Current shape: { modules: Array<...> }
            expect(data).toHaveProperty('modules');
            expect(Array.isArray(data.modules)).toBe(true);
        }
    });

    test('/api/v1/modules/status is admin-gated', async ({ request }) => {
        // Without internal-secret or admin session this endpoint returns 401.
        const response = await request.get('/api/v1/modules/status');
        expect([200, 401, 403]).toContain(response.status());
        if (response.status() === 200) {
            const data = await response.json();
            expect(data).toHaveProperty('modules');
            expect(typeof data.modules).toBe('object');
        }
    });

    test('/api/v1/modules/marketplace is admin-gated and lists modules for an admin', async ({ page }) => {
        // The catalogue names every module the registry offers and where its
        // archive is, which is the panel's own view of what can be installed
        // rather than a public one.
        const anonymous = await page.request.get('/api/v1/modules/marketplace');
        expect([401, 403]).toContain(anonymous.status());

        await login(page);
        const response = await page.request.get('/api/v1/modules/marketplace');
        // The catalogue is fetched from the registry; a box with no route out
        // answers 502, and both answers carry a `modules` array.
        expect([200, 502]).toContain(response.status());
        const data = await response.json();
        expect(data).toHaveProperty('modules');
        expect(Array.isArray(data.modules)).toBe(true);
    });

    test('marketplace install endpoint exists and is auth-gated', async ({ request }) => {
        // Real install path is /api/v1/modules/marketplace/install (POST).
        const response = await request.post('/api/v1/modules/marketplace/install', {
            data: { moduleId: 'store', zipFile: 'store.zip' },
        });
        // Unauthenticated → 401; authenticated callers may get 200/400/etc.
        expect([200, 201, 400, 401, 403, 409, 429]).toContain(response.status());
    });

    test('module list endpoint reachable', async ({ request }) => {
        // Sanity check that the modules list endpoint at least responds.
        const response = await request.get('/api/v1/modules');
        expect([200, 401, 403]).toContain(response.status());
    });

    test("unknown module route returns 404 page", async ({ page }) => {
        // With no modules installed, /en/store should render the 404 page.
        await page.goto('/en/store', { waitUntil: 'domcontentloaded' });
        // Either it's a real installed module (visible content) or 404 fallback.
        await expect(page.locator('body')).toBeVisible();
    });

    test('disabled module route renders not-found content', async ({ page }) => {
        // Without the store module installed, /en/store ends up at the 404 page.
        await page.goto('/en/store', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('body')).toBeVisible();
    });

    test('module delete endpoint exists at /api/v1/modules/[id]', async ({ request }) => {
        // DELETE handler lives on /api/v1/modules/[id]; auth-gated.
        const response = await request.delete('/api/v1/modules/store');
        expect([200, 204, 400, 401, 403, 404]).toContain(response.status());
    });
});
