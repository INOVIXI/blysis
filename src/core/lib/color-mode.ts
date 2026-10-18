/**
 * Where a visitor's own light/dark choice lives.
 *
 * It used to be `localStorage`, applied before paint by an inline script in
 * `<head>`. The server could not read it, so the page it sent was always in
 * the site's mode and the script corrected it a moment later - and the theme
 * provider's effect then corrected it back, which is how a visitor who had
 * picked dark watched every page load turn light.
 *
 * A cookie is readable on the server, so the mode is an attribute on `<html>`
 * in the document the server sends and nothing has to correct anything.
 */
export const COLOR_MODE_COOKIE = "color-mode";

/**
 * The panel's own mode: `light`, `dark`, or `site` to be drawn like the site.
 *
 * The panel and the site shared `color-mode`, so the panel's moon button made
 * the site dark too. They are two choices now.
 */
export const ADMIN_COLOR_MODE_COOKIE = "admin-color-mode";

/**
 * What the reader's system was last seen to prefer, for a site that follows
 * it. Chromium says so in a request header (`Sec-CH-Prefers-Color-Scheme`,
 * which the proxy asks for); other browsers only answer in the page, so the
 * page writes it here and the next request is drawn right from the start.
 */
export const SYSTEM_SCHEME_COOKIE = "prefers-color-scheme";

/** The client hint carrying the reader's system preference. */
export const SYSTEM_SCHEME_HINT = "sec-ch-prefers-color-scheme";

/**
 * Set by the proxy on a page request: `admin` for the panel, `site` for
 * everything else. A layout is not given the pathname, and the root layout is
 * where `<html data-mode>` is written.
 */
export const SURFACE_HEADER = "x-blysis-surface";

/** The setting that holds the site's mode: no visitor toggle, no visitor choice. */
export const COLOR_MODE_LOCK_SETTING = "color_mode_locked";

/** A year. The choice is a preference, not a session. */
export const COLOR_MODE_MAX_AGE = 60 * 60 * 24 * 365;
