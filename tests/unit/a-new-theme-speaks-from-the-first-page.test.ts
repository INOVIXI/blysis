// @vitest-environment node
/**
 * A theme switched on speaks its own strings from the next page drawn.
 *
 * A theme's strings reach a page through the translation catalogue, which
 * carries the strings of the theme being worn and is held for two minutes.
 * Switching themes did not drop it, so for up to two minutes the new theme
 * drew every one of its own lines as a missing message, and the panel showed
 * its settings labels as raw keys, on the screen where the operator had just
 * picked it.
 */
import { describe, it, expect, vi } from "vitest";

const deleted = vi.hoisted(() => [] as string[]);

vi.mock("@/core/lib/db", () => ({
    prisma: { themeState: { upsert: vi.fn(async () => ({})) } },
}));
vi.mock("@/core/lib/redis", () => ({
    cacheGet: vi.fn(async () => null),
    cacheSet: vi.fn(async () => {}),
    cacheDel: vi.fn(async (key: string) => {
        deleted.push(key);
    }),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

const { setActiveTheme } = await import("@/core/lib/theme-state");
const { locales } = await import("@/core/lib/i18n/config");

describe("switching the theme", () => {
    it("drops every locale's catalogue, so the next page carries the new theme's strings", async () => {
        await setActiveTheme("vanguard", "light");
        for (const locale of locales) expect(deleted).toContain(`blysis:translations:${locale}`);
    });
});
