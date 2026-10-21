import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

/**
 * A request context carries no session, so every answer to it from an
 * admin endpoint is a refusal, and exactly one: these used to accept a 200
 * alongside the 401, which would have passed with the auth check gone, and
 * the delete would have uninstalled the store on the way.
 *
 * A write without an Origin is turned away by the CSRF gate before auth is
 * asked, so the writes below send the site's own origin to reach the check
 * they are about.
 */
test.describe('Module System', () => {
    test('/api/v1/modules refuses a stranger and lists modules for an admin', async ({ page }) => {
        const anonymous = await page.request.get('/api/v1/modules');
        expect(anonymous.status()).toBe(401);

        await login(page);
        const response = await page.request.get('/api/v1/modules');
        expect(response.status()).toBe(200);
        const data = await response.json();
        expect(Array.isArray(data.modules)).toBe(true);
    });

    test('/api/v1/modules/status refuses a stranger, even one claiming to be internal', async ({ page }) => {
        expect((await page.request.get('/api/v1/modules/status')).status()).toBe(401);
        const claimed = await page.request.get('/api/v1/modules/status', {
            headers: { 'x-internal-request': '1' },
        });
        expect(claimed.status()).toBe(401);

        await login(page);
        const response = await page.request.get('/api/v1/modules/status');
        expect(response.status()).toBe(200);
        expect(typeof (await response.json()).modules).toBe('object');
    });

    test('/api/v1/modules/marketplace is admin-gated and lists modules for an admin', async ({ page }) => {
        // The catalogue names every module the registry offers and where its
        // archive is, which is the panel's own view of what can be installed
        // rather than a public one.
        const anonymous = await page.request.get('/api/v1/modules/marketplace');
        expect(anonymous.status()).toBe(401);

        await login(page);
        const response = await page.request.get('/api/v1/modules/marketplace');
        // The catalogue is fetched from the registry; a box with no route out
        // answers 502, and both answers carry a `modules` array.
        expect([200, 502]).toContain(response.status());
        const data = await response.json();
        expect(data).toHaveProperty('modules');
        expect(Array.isArray(data.modules)).toBe(true);
    });

    test('marketplace install refuses a stranger', async ({ request, baseURL }) => {
        const response = await request.post('/api/v1/modules/marketplace/install', {
            headers: { origin: new URL(baseURL!).origin },
            data: { moduleId: 'store', zipFile: 'store.zip' },
        });
        expect(response.status()).toBe(401);
    });

    test('module delete refuses a stranger', async ({ request, baseURL }) => {
        const response = await request.delete('/api/v1/modules/store', {
            headers: { origin: new URL(baseURL!).origin },
        });
        expect(response.status()).toBe(401);
    });

    test('a page an installed module declares is served', async ({ page }) => {
        // CI installs every module from module-sources before this runs, so
        // the store's page is there to be served rather than the 404 page.
        // A route nobody declares is core.spec.ts's 404 test.
        const response = await page.goto('/en/store', { waitUntil: 'domcontentloaded' });
        expect(response?.status()).toBe(200);
        await expect(page.getByText(/Page Not Found/i)).toHaveCount(0);
    });
});
