/**
 * @public-read: the site's own name, logo, description and which profile
 * controls it offers - drawn on every page before anybody has signed in, which
 * is why it is public. The keys are an allowlist, `PUBLIC_KEYS` beside
 * `readPublicSettings`, rather than whatever is in the table, and the answer
 * is served from a cache with its own TTL, so the work a caller can make it do
 * is bounded whatever they ask for.
 */
import { NextResponse } from "next/server";
import { readPublicSettings } from "@/core/lib/public-settings";

// GET /api/v1/public-settings
export async function GET() {
    // The allowlist and its cache live with the reader, which the root layout
    // shares so the first paint already carries these values.
    const { settings, cacheSeconds } = await readPublicSettings();

    return NextResponse.json({
        settings,
        // The browser reuses the payload for this long; see useSiteSettings.
        cacheSeconds,
        // Exposed so the login page can show its credentials banner on the
        // demo instance without baking the flag into client code.
        isDemo: process.env.DEMO_MODE === "1",
    }, {
        headers: {
            "Cache-Control": `public, max-age=0, s-maxage=${Math.floor(cacheSeconds / 2)}, stale-while-revalidate=${cacheSeconds}`,
        },
    });
}
