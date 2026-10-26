import { test, expect } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * An operator writes `{servers.online}` into a headline; a visitor reads a
 * number, or a dash when there is none, and never the braces.
 *
 * Measured in the built site because the value travels through the root
 * layout, the provider and the theme's own reading of its settings, and a
 * break anywhere along that line shows as the raw token on the page.
 */
test("a headline's site placeholder reaches the visitor filled", async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await login(page);
    const state = await (await page.request.get("/api/v1/themes/state")).json();
    test.skip(state?.themeId !== "flat", "the headline is Flat's");

    const url = "/api/v1/themes/flat/settings/hero";
    const before = (await (await page.request.get(url)).json()).values ?? {};
    const put = (values: Record<string, unknown>) => page.request.put(url, { headers: { origin }, data: { values } });
    try {
        expect((await put({ enabled: true, title: "Şu an {servers.online} kişi", subtitle: "{site.name}" })).ok()).toBe(true);
        await page.goto("/tr");
        const headline = page.getByRole("heading", { name: /^Şu an / });
        await expect(headline).toBeVisible();
        await expect(headline).toHaveText(/^Şu an (\d[\d.]*|–) kişi$/);
        await expect(page.locator("body")).not.toContainText("{servers.online}");
        await expect(page.locator("body")).not.toContainText("{site.name}");
    } finally {
        const keys = ["enabled", "title", "subtitle"];
        await put(Object.fromEntries(keys.map((key) => [key, key in before ? before[key] : null])));
    }
});
