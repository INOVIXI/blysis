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
 * Three answers, because an operator has three positions and only two were
 * offered.
 *
 * `upload` lets a member send a file. `link` takes that away and still lets
 * them point at a picture they host. `off` is the one that was missing: no
 * member picture at all, everybody drawn from their name - which is what a
 * site that does not want to police images at all actually wants, and the
 * only setting that stops a member putting a picture on their profile by
 * pasting an address.
 *
 * Stored as JSON. The older spellings still arrive from installations written
 * before there was a third answer: `true` was upload, `false` was link.
 */
type AvatarPolicy = "upload" | "link" | "off";

/** Not exported: the two questions callers actually ask are below. */
function memberAvatarPolicy(stored: unknown): AvatarPolicy {
    if (stored === true) return "upload";
    if (stored === false) return "link";
    if (typeof stored === "string") {
        const said = stored.trim().toLowerCase();
        if (said === "off") return "off";
        if (said === "link" || said === "false") return "link";
        if (said === "upload" || said === "true") return "upload";
    }
    // Nothing said. A member with no picture is the state the door exists to
    // fix, so a site that never opens the settings screen gets the useful
    // behaviour.
    return "upload";
}

/** Whether the upload control is drawn at all. */
export function memberAvatarUploads(stored: unknown): boolean {
    return memberAvatarPolicy(stored) === "upload";
}

/** Whether a member may set a picture by any means. */
export function memberAvatarsAllowed(stored: unknown): boolean {
    return memberAvatarPolicy(stored) !== "off";
}
