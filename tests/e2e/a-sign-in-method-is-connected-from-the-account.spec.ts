import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

/**
 * A member attaches a provider sign-in to the account they already have, from
 * their own account page, and an operator sees and can remove it from the
 * member's screen in the panel.
 *
 * The provider's half cannot run here: it is somebody else's site. What can
 * is everything on ours. When the server has a provider configured, Connect
 * must leave for that provider rather than for a page of ours; when the
 * sign-in callback refuses, the reason it puts in the address must reach the
 * member in words.
 */
test.describe('Sign-in methods', () => {
    test.beforeEach(async ({ page }) => {
        await login(page);
    });

    test('the account page lists them and Connect leaves for the provider', async ({ page, baseURL }) => {
        await page.goto('/en/profile?section=sign-in-methods');
        await expect(page.getByText('Connect an account you hold elsewhere')).toBeVisible();

        const connect = page.getByRole('button', { name: /^Connect / });
        if ((await connect.count()) === 0) {
            await expect(page.getByText('This site offers no other sign-in methods.')).toBeVisible();
            return;
        }

        const home = new URL(baseURL ?? page.url()).origin;
        // The provider is never reached: the first request off this site is
        // the proof the flow started, and it is stopped there.
        await page.route((url) => url.origin !== home, (route) => route.abort());
        const leaving = page.waitForRequest((request) => new URL(request.url()).origin !== home && request.isNavigationRequest());
        await connect.first().click();
        const request = await leaving;
        expect(new URL(request.url()).searchParams.get('state') ?? new URL(request.url()).searchParams.get('code_challenge')).toBeTruthy();
    });

    test('a refused connect says why and leaves the address clean', async ({ page }) => {
        await page.goto('/en/profile?section=sign-in-methods&connectError=taken');
        await expect(page.getByText('That account is already connected to another member here.')).toBeVisible();
        await expect(page).toHaveURL(/section=sign-in-methods$/);
    });

    test('the member screen in the panel shows them', async ({ page }) => {
        const profile = await page.request.get('/api/v1/auth/profile');
        const { user } = (await profile.json()) as { user: { id: string } };

        await page.goto(`/en/admin/users/${user.id}`);
        await expect(page.getByText('Sign-in methods', { exact: true })).toBeVisible();
        await expect(page.getByText('Has a password.')).toBeVisible();
    });
});

test('a provider sign-in nobody connected says to connect it first', async ({ page }) => {
    await page.goto('/en/auth/error?error=ConnectFirst');
    await expect(page.getByText('connect it from your account page')).toBeVisible();
});
