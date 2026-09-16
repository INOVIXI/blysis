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

/** A year. The choice is a preference, not a session. */
export const COLOR_MODE_MAX_AGE = 60 * 60 * 24 * 365;
