import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
    SITE_SOCIAL_LINKS,
    siteFormFromSettings,
    siteSettingsPatch,
    withEnvironmentFallbacks,
} from "@/core/lib/site-contact";

/**
 * Admin > Settings > Site saves what the site reads.
 *
 * The screen wrote `siteName`, `siteDescription`, `contactEmail` and five
 * `social*` keys. Nothing read any of them: the site's name, description and
 * contact address are `site_name`, `site_description` and `site_email`, and
 * the footer took its social links from `SOCIAL_*` environment variables read
 * in a client component, where a variable without the `NEXT_PUBLIC_` prefix
 * is always empty. An operator renamed their site, saw "Saved", and nothing
 * changed anywhere.
 */

const ROOT = process.cwd();

describe("the site screen's form", () => {
    it("is filled from the keys the site reads", () => {
        const form = siteFormFromSettings({
            site_name: "Acme",
            site_description: "A server",
            site_email: "hi@acme.test",
            site_discord_url: "https://discord.gg/acme",
            site_tiktok_url: "https://tiktok.com/@acme",
            site_timezone: "Europe/Istanbul",
        });
        expect(form.site_name).toBe("Acme");
        expect(form.site_description).toBe("A server");
        expect(form.site_email).toBe("hi@acme.test");
        expect(form.site_discord_url).toBe("https://discord.gg/acme");
        expect(form.site_tiktok_url).toBe("https://tiktok.com/@acme");
        expect(form.site_timezone).toBe("Europe/Istanbul");
    });

    it("shows a value an older screen saved under its own key, so the next save keeps it", () => {
        const form = siteFormFromSettings({
            siteName: "Old Name",
            contactEmail: "old@acme.test",
            socialTwitter: "https://x.com/acme",
            hero_discord_url: "https://discord.gg/old",
        });
        expect(form.site_name).toBe("Old Name");
        expect(form.site_email).toBe("old@acme.test");
        expect(form.site_x_url).toBe("https://x.com/acme");
        expect(form.site_discord_url).toBe("https://discord.gg/old");
    });

    it("prefers the key the site reads over an old one", () => {
        expect(siteFormFromSettings({ site_name: "New", siteName: "Old" }).site_name).toBe("New");
    });

    it("defaults the zone, and nothing else", () => {
        const form = siteFormFromSettings({});
        expect(form.site_timezone).toBe("UTC");
        expect(form.site_name).toBe("");
    });
});

describe("what the screen saves", () => {
    it("writes the keys the site reads", () => {
        const form = siteFormFromSettings({});
        const patch = siteSettingsPatch({ ...form, site_name: "Acme", site_youtube_url: "https://youtube.com/@acme" }, {});
        expect(patch.site_name).toBe("Acme");
        expect(patch.site_youtube_url).toBe("https://youtube.com/@acme");
        for (const key of Object.keys(patch)) expect(key).toMatch(/^site_[a-z_]+$/);
    });

    it("empties an old key it carried forward, so clearing the field later is not undone by it", () => {
        const loaded = { socialFacebook: "https://facebook.com/acme", siteDescription: "" };
        const patch = siteSettingsPatch(siteFormFromSettings(loaded), loaded);
        expect(patch.site_facebook_url).toBe("https://facebook.com/acme");
        expect(patch.socialFacebook).toBe("");
        // An old key that held nothing is not written at all.
        expect("siteDescription" in patch).toBe(false);
    });
});

describe("the documented environment variables", () => {
    it("fill a link the operator has not set, on the server where they can be read", () => {
        const settings = withEnvironmentFallbacks(
            { site_x_url: "https://x.com/saved" },
            { SOCIAL_TWITTER: "https://x.com/env", SOCIAL_YOUTUBE: "https://youtube.com/env", SITE_EMAIL: "env@acme.test", COMMUNITY_URL: "https://discord.gg/env" },
        );
        expect(settings.site_x_url).toBe("https://x.com/saved");
        expect(settings.site_youtube_url).toBe("https://youtube.com/env");
        expect(settings.site_email).toBe("env@acme.test");
        expect(settings.site_discord_url).toBe("https://discord.gg/env");
    });

    it("lose to the old Discord key the footer still reads", () => {
        const settings = withEnvironmentFallbacks({ hero_discord_url: "https://discord.gg/saved" }, { COMMUNITY_URL: "https://discord.gg/env" });
        expect(settings.site_discord_url).toBeUndefined();
    });

    it("leave the settings it was given untouched", () => {
        const given = { site_name: "Acme" };
        withEnvironmentFallbacks(given, { SOCIAL_FACEBOOK: "https://facebook.com/env" });
        expect(given).toEqual({ site_name: "Acme" });
    });
});

describe("the wiring", () => {
    const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

    it("publishes and caps every link the footer reads", () => {
        const publicRoute = read("src/app/api/v1/public-settings/route.ts");
        const settingsRoute = read("src/app/api/v1/settings/route.ts");
        expect(SITE_SOCIAL_LINKS.length).toBe(6);
        for (const link of SITE_SOCIAL_LINKS) {
            expect(publicRoute, link.key).toContain(`"${link.key}"`);
            expect(settingsRoute, link.key).toContain(`${link.key}: 500`);
        }
        expect(publicRoute).toContain("withEnvironmentFallbacks(");
    });

    it("reads no environment variable in the browser for a link", () => {
        const footer = read("src/core/hooks/useFooter.ts");
        expect(footer).not.toContain("serverConfig.social");
        expect(footer).not.toContain("serverConfig.email");
        expect(footer).not.toContain("serverConfig.communityUrl");
    });

    it("builds the screen from the form helpers", () => {
        const screen = read("src/app/[locale]/(admin)/admin/settings/site/page.tsx");
        expect(screen).toContain("siteFormFromSettings(");
        expect(screen).toContain("siteSettingsPatch(");
        expect(screen).not.toMatch(/\b(siteName|siteDescription|contactEmail|socialTwitter):/);
    });
});
