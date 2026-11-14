import { test, expect } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * An operator saves a provider's key on its own screen, and the AI screen then
 * calls that provider ready. Claude stands in for the three: their screens
 * are built the same way.
 *
 * The key is a placeholder, and the run never presses "Try the connection",
 * so nothing leaves the test server. A site that already holds a key is left
 * alone rather than overwritten; the placeholder is removed afterwards.
 */
const PROVIDER = "anthropic-provider";
const NAME = "Claude (Anthropic)";

test("a provider is ready once its key is saved", async ({ page, baseURL }) => {
    await login(page);
    const origin = new URL(baseURL!).origin;
    const before = await (await page.request.get("/api/v1/admin/ai")).json();
    const row = (before.providers as { id: string; enabled: boolean; configured: boolean }[]).find((p) => p.id === PROVIDER);
    test.skip(!row || !row.enabled, "the Claude provider is not installed and on in this build");
    test.skip(row!.configured, "this site already holds a Claude key, which a test must not replace");

    try {
        await page.goto("/en/admin/settings/ai");
        const listed = page.getByRole("listitem").filter({ hasText: NAME });
        await expect(listed.getByText("Needs its key")).toBeVisible();

        await page.goto("/en/admin/settings/anthropic");
        await expect(page.getByRole("heading", { name: "Anthropic settings" })).toBeVisible();
        await expect(page.getByText("Not set")).toBeVisible();
        await page.getByLabel("API key").fill("sk-ant-e2e-placeholder-not-a-key");
        await page.getByRole("button", { name: "Save Settings" }).click();
        await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

        await page.goto("/en/admin/settings/ai");
        await expect(page.getByRole("listitem").filter({ hasText: NAME }).getByText("Ready")).toBeVisible();
    } finally {
        await page.request.patch("/api/v1/settings", { headers: { origin }, data: { anthropic_api_key: "" } });
    }
});
