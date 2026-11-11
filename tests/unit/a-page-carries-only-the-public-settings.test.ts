/**
 * What the root layout hands every page is what any visitor may read.
 *
 * The layout puts the public site settings into the HTML so the page is drawn
 * with them on its first pass. That HTML goes to whoever asks, signed in or
 * not, so the reader it uses is the one `/api/v1/public-settings` uses, and it
 * asks the database for the allowlisted keys only, never the table.
 */
import { describe, it, expect, vi } from "vitest";

const findMany = vi.fn(async (args: { where: { key: { in: string[] } } }) =>
    args.where.key.in.includes("site_name") ? [{ key: "site_name", value: "Vanilya" }] : []);

vi.mock("@/core/lib/db", () => ({ prisma: { setting: { findMany } } }));

// The cache would hide the query this test is about.
vi.mock("@/core/lib/cache", () => ({
    cached: async <T,>(_key: string, _ttl: number, loader: () => Promise<T>) => loader(),
}));

vi.mock("@/core/lib/security-settings", () => ({
    SETTINGS_CACHE: {},
    getDurationMs: async () => 90_500,
}));

const { readPublicSettings } = await import("@/core/lib/public-settings");

describe("the public settings a page carries", () => {
    it("are the allowlisted keys and nothing else", async () => {
        const answer = await readPublicSettings();
        expect(answer.settings).toEqual({ site_name: "Vanilya" });

        const asked = findMany.mock.calls[0][0].where.key.in;
        expect(asked).toContain("site_name");
        expect(asked).toContain("default_currency");
        expect(asked).not.toContain("smtp_password");
        expect(asked).not.toContain("settings_cache_seconds");
    });

    it("say how long the browser may keep them, in whole seconds", async () => {
        expect((await readPublicSettings()).cacheSeconds).toBe(90);
    });
});
