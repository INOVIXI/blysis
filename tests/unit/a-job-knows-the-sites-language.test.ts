// @vitest-environment node
/**
 * Work that runs with no visitor, a scheduled job or a hook, still has to
 * write in the site's language: a reviewing module's rationale is read by the
 * site's admins. `siteLanguage` is the language the site opens in, and a
 * database that cannot be read answers with the shipped default rather than
 * failing the job.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let rows: { key: string; value: unknown }[] | Error = [];

vi.mock("@/core/lib/db", () => ({
    default: {
        setting: {
            findMany: async () => {
                if (rows instanceof Error) throw rows;
                return rows;
            },
        },
    },
}));

const { siteLanguage, invalidateSiteLanguages } = await import("@/core/lib/i18n/site-languages-setting");
const { defaultLocale } = await import("@/core/lib/i18n/config");

beforeEach(() => {
    invalidateSiteLanguages();
});

describe("siteLanguage", () => {
    it("is the language the site opens in", async () => {
        rows = [{ key: "site_languages", value: ["en", "tr"] }, { key: "default_locale", value: "tr" }];
        expect(await siteLanguage()).toBe("tr");
    });

    it("is the shipped default when the settings cannot be read", async () => {
        rows = new Error("database down");
        expect(await siteLanguage()).toBe(defaultLocale);
    });
});
