/**
 * The mark an installation puts on itself.
 *
 * `site_name` has been an operator setting for a long time and `SiteName`
 * reads it everywhere, but there was no logo to go with it: the admin rail
 * had only the name's initials to draw in its square, and `public/logo.png`
 * was the product's own mark, shipped in the tree and referenced by nothing.
 *
 * No imports. The settings screen that offers the field is a client
 * component, and a file that reads the database cannot be named from one -
 * `client-bundle-safety` measured that on `member-uploads.ts` and found
 * `@prisma/client` in the browser bundle. This file says what the key is;
 * whoever already has a connection does the reading.
 */
export const SITE_LOGO_KEY = "site_logo";

/**
 * The stored value as an address, or null.
 *
 * Null is an answer: an installation with no logo draws its name's initials,
 * which is what the square did before there was a logo at all.
 */
export function siteLogo(stored: unknown): string | null {
    if (typeof stored !== "string") return null;
    const trimmed = stored.trim();
    return trimmed.length > 0 ? trimmed : null;
}
