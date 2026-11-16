/**
 * Whether a stored string is an address a page may draw a picture from.
 *
 * Two kinds are: an http(s) address, and a file under the site's own
 * `/uploads/`, which is what an upload to a site that keeps its files on its
 * own disk answers. Fields used to ask zod for `.url()`, which refused the
 * second kind, so a picture could be linked from elsewhere but not uploaded,
 * and accepted any scheme at all, `javascript:` included.
 *
 * The upload path is checked segment by segment rather than by prefix: a
 * prefix is not containment (`/uploads/../x` starts with `/uploads/` too),
 * and a backslash or an encoded dot is a way to spell a climb a browser or a
 * proxy may undo. `//host/...` names another host without a scheme and is
 * refused with every other form.
 */
const UPLOADS = "/uploads/";

function isUploadPath(value: string): boolean {
    if (!value.startsWith(UPLOADS) || value.includes("\\") || /%2e|%2f|%5c/i.test(value)) return false;
    const rest = value.slice(UPLOADS.length);
    if (rest === "") return false;
    return rest.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isWebAddress(value: string): boolean {
    try {
        const url = new URL(value);
        return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
    } catch {
        return false;
    }
}

export function isPictureAddress(value: string): boolean {
    return isUploadPath(value) || isWebAddress(value);
}
