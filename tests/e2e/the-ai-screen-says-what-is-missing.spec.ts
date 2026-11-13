import { test, expect } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * The AI screen on a site with no AI provider installed, which is every site
 * until an operator installs one: it says so on the screen and points at
 * where to get one, and the limits it shows are the ones it saved.
 *
 * The retention value is put back afterwards, whatever the run did.
 */
test("the AI screen says what is missing and keeps what it saves", async ({ page, baseURL }) => {
    await login(page);
    const origin = new URL(baseURL!).origin;
    const before = await (await page.request.get("/api/v1/admin/ai")).json();
    const kept: number = before.settings.retentionDays;
    const next = kept === 45 ? 46 : 45;

    try {
        await page.goto("/en/admin/settings/ai");

        const missing = page.getByTestId("ai-no-provider");
        await expect(missing).toBeVisible();
        await expect(missing.getByRole("link")).toHaveAttribute("href", /\/admin\/modules$/);

        const retention = page.getByLabel("Keep usage records for (days)");
        await expect(retention).toHaveValue(String(kept));
        await retention.fill(String(next));
        await page.getByRole("button", { name: "Save" }).click();
        await expect(page.getByText("AI settings saved")).toBeVisible();

        await page.reload();
        await expect(page.getByLabel("Keep usage records for (days)")).toHaveValue(String(next));
    } finally {
        await page.request.patch("/api/v1/admin/ai", { headers: { origin }, data: { retentionDays: kept } });
    }
});
