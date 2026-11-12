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

/**
 * The icon in the browser tab and on a phone's home screen.
 *
 * It was three files in `src/app`, so changing it meant editing the
 * installation's source. A logo is drawn beside the name at any size; a tab
 * icon is drawn at sixteen pixels, so the two are separate settings and an
 * operator can upload a mark that still reads that small.
 */
export const SITE_ICON_KEY = "site_icon";

interface IconLink {
    url: string;
    sizes?: string;
    type?: string;
}

/**
 * The `icons` of the root layout's metadata.
 *
 * Unset, the icons that ship, from `public/`: Next lets an icon file in
 * `src/app` outrank the icons metadata names, so they cannot live there
 * (`an-installation-wears-its-own-name`).
 */
export function siteIconMetadata(stored: unknown): { icon: IconLink[]; apple: IconLink[] } {
    const icon = siteLogo(stored);
    if (icon) return { icon: [{ url: icon }], apple: [{ url: icon }] };
    return {
        icon: [
            { url: "/favicon.ico", sizes: "any" },
            { url: "/icon.svg", type: "image/svg+xml" },
        ],
        apple: [{ url: "/apple-icon.png" }],
    };
}
