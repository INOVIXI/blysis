/**
 * Whether a member may put a picture on their own profile.
 *
 * Uploading is an operator's tool everywhere else on this site: the media
 * library takes 50 MB of anything on its allowlist and an admin decides what
 * goes in it. A member's avatar is the one image that belongs to the person
 * looking at it, so it gets its own narrow door rather than a key to that one
 * - and an operator who does not want member-supplied pictures at all can
 * close it here instead of policing them.
 *
 * No imports. The admin screen that offers the switch is a client component,
 * and a file that reads the database cannot be named from one: measured by
 * `client-bundle-safety`, importing the reader from there pulled
 * `@prisma/client` into the browser bundle. So this file says what the key is
 * and what its values mean, and whoever already has a database connection -
 * the route - does the reading.
 */
export const MEMBER_AVATAR_UPLOADS_KEY = "member_avatar_uploads";

/**
 * On unless it is explicitly turned off. A member with no picture is the
 * state the door exists to fix, so a site that never opens the settings
 * screen gets the useful behaviour.
 *
 * Stored as JSON, so it arrives as a boolean from a toggle and as a string
 * from anything that wrote it by hand. Both spellings of "off" mean off.
 */
export function memberAvatarUploads(stored: unknown): boolean {
    if (stored === false) return false;
    if (typeof stored === "string" && stored.trim().toLowerCase() === "false") return false;
    return true;
}
