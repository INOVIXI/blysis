/**
 * @public-read: the site's own name, logo, description and which profile
 * controls it offers - drawn on every page before anybody has signed in, which
 * is why it is public. The keys are an allowlist below rather than whatever is
 * in the table, and the answer is served from a cache with its own TTL, so the
 * work a caller can make it do is bounded whatever they ask for.
 */
import { NextResponse } from "next/server";
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
    "site_email",
    "site_discord_url",
    // Rendered by the footer. Core hardcodes no column at all: the headings,
    // the links and which module section each column adopts are the
    // operator's, in `footer_columns`. The two older keys stay on the list
    // because they still hold the footer of every install that has not opened
    // the editor, and the footer reads them when `footer_columns` is absent.
    "footer_about_text",
    "footer_columns",
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
    // Admin > Settings > Widgets writes both of these, and the homepage is
    // the only thing that reads them. Leaving them off this list meant the
    // customiser saved preferences the page it configures never received.
    "widget_visibility",
    "widget_order",
    // Back-compat alias the footer falls back to; unreachable while it was
    // absent here, so the fallback it documents never resolved.
    "hero_discord_url",
];

const PUBLIC_SETTINGS_CACHE_KEY = "public-settings";

// GET /api/v1/public-settings
export async function GET() {
    // How long this response may be reused - admin-configurable, clamped.
    const ttlMs = await getDurationMs(SETTINGS_CACHE);

    const settingsMap = await cached<Record<string, unknown>>(
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

    return NextResponse.json({
        settings: settingsMap,
        // The browser reuses the payload for this long; see useSiteSettings.
        cacheSeconds: Math.floor(ttlMs / 1000),
        // Exposed so the login page can show its credentials banner on the
        // demo instance without baking the flag into client code.
        isDemo: process.env.DEMO_MODE === "1",
    }, {
        headers: {
            "Cache-Control": `public, max-age=0, s-maxage=${Math.floor(ttlMs / 2000)}, stale-while-revalidate=${Math.floor(ttlMs / 1000)}`,
        },
    });
}
