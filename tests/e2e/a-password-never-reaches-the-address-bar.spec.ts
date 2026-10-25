import { test, expect } from "@playwright/test";

/**
 * A password typed before the page has finished loading stays out of the URL.
 *
 * The forms are submitted by script, and until the script has taken the form
 * over a press of the button is the browser's own submit: a GET to the same
 * page with every named field in the query. The sign-up form names its
 * fields, so a visitor on a slow phone who pressed the button early sent
 * their new password into the address bar, the browser's history and the
 * server's request log. JavaScript switched off is that same moment, held.
 */
test.use({ javaScriptEnabled: false });

test("the sign-up form sent before its script runs keeps the password out of the URL", async ({ page }) => {
    await page.goto("/tr/auth/register");
    await page.locator('input[name="email"]').fill("early@example.com");
    await page.locator('input[name="username"]').fill("early");
    await page.locator('input[name="password"]').fill("Typed-Too-Soon-1");
    await page.locator('input[name="confirmPassword"]').fill("Typed-Too-Soon-1");
    await Promise.all([
        page.waitForNavigation(),
        page.locator('button[type="submit"]').first().click(),
    ]);
    expect(page.url()).not.toContain("Typed-Too-Soon-1");
    expect(new URL(page.url()).search).toBe("");
});
