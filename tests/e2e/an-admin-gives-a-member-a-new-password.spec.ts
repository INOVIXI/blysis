import { test, expect } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * An administrator gives a member a new password from the member's page, and
 * the member signs in with it.
 *
 * The member is made for the run through the same endpoint the panel's "add
 * a user" uses, and deleted afterwards.
 */

test("an admin gives a member a new password they can sign in with", async ({ page, browser, baseURL }) => {
    test.setTimeout(90_000);
    const origin = new URL(baseURL!).origin;
    await login(page);

    const stamp = Date.now().toString(36);
    const username = `pw_${stamp}`;
    const email = `${username}@example.com`;
    const created = await page.request.post("/api/v1/users", {
        headers: { origin },
        data: { email, username, password: `First-${stamp}-Pass9` },
    });
    expect(created.ok(), "making the member").toBe(true);
    const userId: string = (await created.json()).user.id;
    const newPassword = `Second-${stamp}-Pass7`;

    try {
        await page.goto(`/en/admin/users/${userId}`);
        await expect(page.getByRole("heading", { name: "Password", exact: true })).toBeVisible();
        await page.getByLabel("New password", { exact: true }).fill(newPassword);
        await page.getByRole("button", { name: "Set password" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Set password" }).click();
        await expect(page.getByText(`Password set. ${username} is signed out everywhere.`)).toBeVisible();

        // The member, in a browser of their own, signs in with the new one.
        const member = await browser.newContext();
        try {
            await login(await member.newPage(), email, newPassword);
        } finally {
            await member.close();
        }
    } finally {
        await page.request.post(`/api/v1/users/${userId}/delete`, {
            headers: { origin },
            data: { confirmUsername: username, reason: "e2e" },
        });
    }
});
