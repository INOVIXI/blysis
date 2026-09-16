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
    if (isValid(input.siteDefault)) return input.siteDefault;
    if (input.systemPrefersDark && available.includes("dark")) return "dark";
    return input.manifest.modes.default;
}
