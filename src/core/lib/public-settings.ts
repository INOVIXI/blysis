/**
 * The site settings any visitor may read, and the one place they are read.
 *
 * `/api/v1/public-settings` serves them to the browser, and the root layout
 * reads them on the server so the page is drawn with them on its first pass:
 * the navbar, the footer and every price used to arrive with the shipped name
 * and USD and correct themselves in the browser, and React logged the
 * difference as a hydration mismatch on every page. Both read through here so
 * the two can never disagree about which keys are public.
 * `tests/unit/the-sites-name-is-the-same-on-both-sides.test.tsx` holds the
 * first render.
 */
import { prisma } from "@/core/lib/db";
import { cached } from "@/core/lib/cache";
import { SETTINGS_CACHE, getDurationMs } from "@/core/lib/security-settings";

// Public settings keys that can be read without authentication.
// Only core platform keys - module-specific settings (Discord widget IDs,
// hero text, server IPs, etc.) live in their own module's public API.
// Themes that need extra public values use the theme.json schema-driven
// settings system (read via useThemeConfig, not from here).
const PUBLIC_KEYS = [
    "site_name",
    // The mark beside the name. Public for the same reason the name is: it is
    // drawn in the admin rail and belongs to what the site looks like, not to
    // what it keeps. Unset, the rail draws the icon the installation ships.
    "site_logo",
    "site_description",
    // What the profile screen may offer. Not secrets: they describe which
    // controls a member sees, and a member who tries anyway is refused by the
    // endpoint - the screen just stops promising something the site will not
    // do. The rail drew the initials of a name it could read; a profile that
    // offered a field the operator had closed would be the same mistake with
    // a save button on it.
    // The same reason as the three below: the profile screen draws an upload
    // button only if the site has one to offer. The endpoint refuses either
    // way; this stops the screen promising it.
    "member_avatar_uploads",
    "member_username_changes",
    "member_email_changes",
    "identity_requires_password",
    "site_email",
    "site_discord_url",
    // Which languages the footer offers a visitor, and which the site opens
    // in. The proxy keeps a visitor out of the others either way; this stops
    // the picker offering a language that would only redirect.
    "site_languages",
    "default_locale",
    // Rendered by the footer. Core hardcodes no column at all: the headings,
    // the links and which module section each column adopts are the
    // operator's, in `footer_columns`. The two older keys stay on the list
    // because they still hold the footer of every install that has not opened
    // the editor, and the footer reads them when `footer_columns` is absent.
    "footer_about_text",
    "footer_columns",
    "footer_hidden_links",
    "footer_quick_links",
    "footer_legal_links",
    "footer_copyright",
    "custom_css",
    "navbar_links",
    // The zone every schedule is read in. The admin product form shows it
    // beside the hours it is asking for, because "18:00" with no zone next to
    // it is what makes somebody schedule a sale three hours out.
    "site_timezone",
    "theme_color_primary",
    "theme_color_secondary",
    "theme_color_accent",
    // What the payment gateways charge in. Every price on the site is
    // written in it, so a client that draws one needs it; checkout has
    // published the same value to the buyer for as long as there was a
    // checkout. The old "currency" and "currency_symbol" keys were on this
    // list with nothing writing them and nothing reading them.
    "default_currency",
    // Theme customizer overrides
    "theme_overrides",
    // Back-compat alias the footer falls back to; unreachable while it was
    // absent here, so the fallback it documents never resolved.
    "hero_discord_url",
];

/** Dropped by every write that changes one of the keys above. */
const PUBLIC_SETTINGS_CACHE_KEY = "public-settings";

/** What a visitor may know about the site, and how long it stays fresh. */
export interface PublicSettings {
    settings: Record<string, unknown>;
    /** Admin-configurable, clamped; the browser reuses the answer this long. */
    cacheSeconds: number;
}

export async function readPublicSettings(): Promise<PublicSettings> {
    const ttlMs = await getDurationMs(SETTINGS_CACHE);

    const settings = await cached<Record<string, unknown>>(
        PUBLIC_SETTINGS_CACHE_KEY,
        ttlMs,
        async () => {
            const rows = await prisma.setting.findMany({
                where: { key: { in: PUBLIC_KEYS } },
            });
            const map: Record<string, unknown> = {};
            for (const s of rows) {
                map[s.key] = s.value;
            }
            return map;
        },
    );

    return { settings, cacheSeconds: Math.floor(ttlMs / 1000) };
}
