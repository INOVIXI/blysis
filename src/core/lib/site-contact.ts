/**
 * What a site says about itself and where else it can be found: the settings
 * Admin > Settings > Site writes and the footer reads.
 *
 * The screen used to write `siteName`, `siteDescription`, `contactEmail` and
 * five `social*` keys that nothing read, while the site read `site_name`,
 * `site_description`, `site_email` and, for the social links, environment
 * variables a client component could never see. One list of keys, here, is
 * what both halves read now (`the-site-screen-writes-what-the-site-reads`).
 *
 * No imports: the settings screen is a client component and the public
 * settings route runs on the server, and both need this.
 */

/** A place the site can be found off the site. */
export interface SiteSocialLink {
    /** The setting that holds the address. */
    key: string;
    /** How the footer names the link. `community` is the site's own Discord. */
    name: "facebook" | "instagram" | "x" | "youtube" | "tiktok" | "community";
    /** The network's own name, which no language translates. */
    label: string;
    /** What an address on it looks like, for the empty field. */
    placeholder: string;
    /** Keys an older screen or version saved the same address under. */
    legacy: string[];
    /** The documented environment variable used while the setting is empty. */
    env: string | null;
}

/** In the order the footer draws them; the site's own community last. */
export const SITE_SOCIAL_LINKS: readonly SiteSocialLink[] = [
    { key: "site_facebook_url", name: "facebook", label: "Facebook", placeholder: "https://facebook.com/...", legacy: ["socialFacebook"], env: "SOCIAL_FACEBOOK" },
    { key: "site_instagram_url", name: "instagram", label: "Instagram", placeholder: "https://instagram.com/...", legacy: ["socialInstagram"], env: "SOCIAL_INSTAGRAM" },
    { key: "site_x_url", name: "x", label: "X", placeholder: "https://x.com/...", legacy: ["socialTwitter"], env: "SOCIAL_TWITTER" },
    { key: "site_youtube_url", name: "youtube", label: "YouTube", placeholder: "https://youtube.com/...", legacy: ["socialYoutube"], env: "SOCIAL_YOUTUBE" },
    { key: "site_tiktok_url", name: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@...", legacy: [], env: null },
    // `hero_discord_url` is where installs migrated from older versions kept
    // it, and the footer still reads it after this one.
    { key: "site_discord_url", name: "community", label: "Discord", placeholder: "https://discord.gg/...", legacy: ["socialDiscord", "hero_discord_url"], env: "COMMUNITY_URL" },
];

/** The text fields of the site screen, each with the older keys it replaces. */
const SITE_TEXT_FIELDS = [
    { key: "site_name", legacy: ["siteName"] },
    { key: "site_description", legacy: ["siteDescription"] },
    { key: "site_email", legacy: ["contactEmail"], env: "SITE_EMAIL" },
] as const;

const DEFAULT_TIMEZONE = "UTC";

/** The site screen's values, keyed by the settings they are saved to. */
export type SiteForm = Record<string, string>;

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function fields(): { key: string; legacy: readonly string[]; env?: string | null }[] {
    return [...SITE_TEXT_FIELDS, ...SITE_SOCIAL_LINKS];
}

/**
 * The form as the screen opens it.
 *
 * A value saved under an older key is shown when the current one is empty, so
 * the first save under this screen carries it to the key the site reads
 * instead of leaving it behind.
 */
export function siteFormFromSettings(settings: Record<string, unknown>): SiteForm {
    const form: SiteForm = {};
    for (const field of fields()) {
        form[field.key] = [field.key, ...field.legacy].map((k) => text(settings[k])).find(Boolean) ?? "";
    }
    form.site_timezone = text(settings.site_timezone) || DEFAULT_TIMEZONE;
    return form;
}

/**
 * The body the screen saves.
 *
 * An older key that held a value at load is emptied: its value is in the
 * current key now, and left in place it would come back the day the operator
 * clears the field on purpose.
 */
export function siteSettingsPatch(form: SiteForm, loaded: Record<string, unknown>): Record<string, string> {
    const patch: Record<string, string> = {};
    for (const field of fields()) {
        patch[field.key] = text(form[field.key]);
        for (const old of field.legacy) {
            if (text(loaded[old])) patch[old] = "";
        }
    }
    patch.site_timezone = text(form.site_timezone) || DEFAULT_TIMEZONE;
    return patch;
}

/**
 * The public settings with the documented environment variables filled in
 * where the operator has set nothing.
 *
 * `.env.example` documents `SITE_EMAIL`, `COMMUNITY_URL` and `SOCIAL_*` as
 * fallbacks, and the footer read them in the browser, where a variable
 * without the `NEXT_PUBLIC_` prefix is always empty. Applied on the server,
 * on the way out of `/api/v1/public-settings`, they reach the footer again.
 */
export function withEnvironmentFallbacks(
    settings: Record<string, unknown>,
    env: Record<string, string | undefined>,
): Record<string, unknown> {
    const out = { ...settings };
    for (const field of fields()) {
        if (!field.env) continue;
        if ([field.key, ...field.legacy].some((k) => text(settings[k]))) continue;
        const value = text(env[field.env]);
        if (value) out[field.key] = value;
    }
    return out;
}
