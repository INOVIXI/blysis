import { test, expect } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * The AI screen says what is missing. On a site with no AI provider installed
 * it says so and points at where to get one; on a build with providers it
 * lists every one of them. Either way the limits it shows are the ones it
 * saved.
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

        const providers: { name: string }[] = before.providers;
        const missing = page.getByTestId("ai-no-provider");
        if (providers.length === 0) {
            await expect(missing).toBeVisible();
            await expect(missing.getByRole("link")).toHaveAttribute("href", /\/admin\/modules$/);
        } else {
            await expect(missing).toHaveCount(0);
            // The settings sidebar lists each provider's screen under the same
            // name, so a row is the item that also carries the provider's state.
            const rows = page.getByRole("listitem").filter({ hasText: /Switched off|Needs its key|Ready/ });
            for (const provider of providers) {
                await expect(rows.filter({ hasText: provider.name })).toBeVisible();
            }
        }

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
