export interface ResolveModeInput {
    manifest: { modes: { default: string; available: Record<string, unknown> } };
    /** Overrides everything, including the visitor. The customizer preview. */
    forced?: string | null;
    /** What this visitor chose for themselves. */
    cookie?: string | null;
    /**
     * `ThemeState.mode`: what the site is drawn in for somebody who has not
     * chosen.
     *
     * It used to arrive as `forced`, which is a different thing and always
     * had a value, so it beat the cookie every time and the cookie branch had
     * never once run. A visitor who picked dark got dark until the page
     * hydrated and then got the site's mode back.
     */
    siteDefault?: string | null;
    systemPrefersDark?: boolean;
}

/**
 * Pick the active mode. Priority:
 *   1. Forced, which only the preview does
 *   2. The visitor's own cookie
 *   3. The site's configured mode
 *   4. prefers-color-scheme ("dark" if available)
 *   5. manifest.modes.default
 * A single-mode theme short-circuits every lookup.
 */
export function resolveMode(input: ResolveModeInput): string {
    const available = Object.keys(input.manifest.modes.available);
    if (available.length === 1) return available[0];

    const isValid = (m: string | null | undefined): m is string =>
        typeof m === "string" && available.includes(m);

    if (isValid(input.forced)) return input.forced;
    if (isValid(input.cookie)) return input.cookie;
    if (input.siteDefault === SYSTEM_MODE) {
        // The reader's system decides, in both directions: a theme whose own
        // default is dark is still light for a reader whose system is.
        const wanted = input.systemPrefersDark ? "dark" : "light";
        if (available.includes(wanted)) return wanted;
    }
    if (isValid(input.siteDefault)) return input.siteDefault;
    if (input.systemPrefersDark && available.includes("dark")) return "dark";
    return input.manifest.modes.default;
}

/**
 * A site default that is not a mode but an instruction: draw the site in
 * whichever of light and dark the reader's operating system prefers.
 */
export const SYSTEM_MODE = "system";

/** What the panel's own choice can say besides a mode: "draw me like the site". */
export const FOLLOW_SITE = "site";

export type Surface = "site" | "admin";

export interface PageModeInput {
    manifest: ResolveModeInput["manifest"];
    surface: Surface;
    /** `ThemeState.mode`: a mode of the theme, or `system`. */
    siteDefault: string | null;
    /** The site holds its mode: the visitor's toggle is hidden and an old choice ignored. */
    locked: boolean;
    /** The visitor's choice for the site (`color-mode`). */
    siteCookie: string | null;
    /** The panel's own choice (`admin-color-mode`): a mode, or `site`. */
    adminCookie: string | null;
    /** What the reader's system prefers, as far as anything has said. */
    systemScheme: "light" | "dark" | null;
}

/**
 * The mode one page is drawn in.
 *
 * The site and the panel used to share one choice, so a dark panel meant a
 * dark site. They are resolved apart now: the site from the visitor's choice
 * (unless the site holds its mode) over the site default; the panel from its
 * own choice, or - when it has none, or chose to follow the site - exactly as
 * the site would be drawn for the same reader. The site's lock is about the
 * site's visitors and never reaches into the panel.
 */
export function resolvePageMode(input: PageModeInput): string {
    const site = resolveMode({
        manifest: input.manifest,
        cookie: input.locked ? null : input.siteCookie,
        siteDefault: input.siteDefault,
        systemPrefersDark: input.systemScheme === "dark",
    });
    if (input.surface === "site") return site;

    const own = input.adminCookie;
    if (own && own !== FOLLOW_SITE && own in input.manifest.modes.available) {
        return resolveMode({ manifest: input.manifest, cookie: own });
    }
    return site;
}
