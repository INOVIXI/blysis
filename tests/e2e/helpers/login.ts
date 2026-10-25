import type { Page } from '@playwright/test';

/**
 * Credentials for the seeded admin user. The login form uses the email field
 * as the identifier.
 *
 * Read from the environment because `prisma/seed.ts` generates a random
 * password unless `SEED_ADMIN_PASSWORD` is set - hardcoding one here meant the
 * suite only ever passed against a developer's hand-made account, which is why
 * it could not run in CI. CI seeds with these same two variables.
 *
 * The fallbacks are what `prisma/seed.ts` makes when it is told nothing, and
 * `the-e2e-login-matches-the-account-the-seed-makes.test.ts` holds them to it.
 * They drifted once: the helper looked for `admin@blysis.com` while the seed
 * wrote `admin@example.com`, and a local run answered with twenty specs each
 * waiting fifteen seconds for a navigation that could never come.
 *
 * No fallback password can be right, because the seed's is random unless it is
 * told otherwise. What `login` can do is say so.
 */
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
export const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'blysisadmin';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin123';

/**
 * Logs a user in via the /tr/auth/login page.
 *
 * The `username` parameter is accepted for API compatibility - if it looks
 * like an email it's used as-is, otherwise the default admin email is used
 * (the login form is email-based in this project).
 */
export async function login(
    page: Page,
    username: string = ADMIN_USERNAME,
    password: string = ADMIN_PASSWORD,
): Promise<void> {
    const email = username.includes('@') ? username : ADMIN_EMAIL;

    await page.goto('/tr/auth/login');
    // Pressed before React has taken the form over, the button is the
    // browser's own submit: the page reloads at `/tr/auth/login?` with
    // nothing sent, and on a busy run that read as a wrong password.
    await page.waitForFunction(() => {
        const form = document.querySelector('form');
        return form !== null && Object.keys(form).some((key) => key.startsWith('__reactProps'));
    });
    await page.locator('input#email, input[type="email"]').first().fill(email);
    await page.locator('input#password, input[type="password"]').first().fill(password);

    try {
        await Promise.all([
            page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 15_000 }),
            page.locator('button[type="submit"]').first().click(),
        ]);
    } catch (err) {
        // A bare waitForURL timeout says nothing about why, and every spec
        // that logs in repeats it. Name the two variables instead: on a box
        // seeded with a random password this is the whole answer.
        throw new Error(
            `Signing in as ${email} did not leave /auth/login within 15s.\n` +
            `If that account is not the one this database was seeded with, set ` +
            `E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (the seed prints its ` +
            `password once, or set SEED_ADMIN_PASSWORD before seeding).\n` +
            `Original: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}
