/**
 * Does this request carry a session cookie?
 *
 * Not "is this visitor signed in" - a cookie can be expired, forged or
 * revoked, and only `auth()` knows. This answers the cheaper question without
 * touching the database, so a caller may treat a false as certain and a true
 * as merely possible.
 *
 * It lives here, out of the proxy, because the proxy asked it with
 * `cookieHeader.includes('authjs.session-token')`. That is also true of a
 * cookie whose *value* contains the text, and a visitor chooses their own
 * values. The cost of that was small - the one caller it could fool skips a
 * redirect the admin page performs for itself - but a helper whose name
 * promises one thing and whose body answers another is a trap for whoever
 * calls it next.
 */

/**
 * The names Auth.js may use. `__Secure-` and `__Host-` are added by the
 * browser-facing prefixes it sets over https, and `next-auth.` is the name it
 * used before the rename, still present in a session issued by an older build.
 */
/**
 * Whether this deployment hands the browser prefixed, `Secure` cookies.
 *
 * Decided on the scheme the site is actually served over rather than on
 * NODE_ENV, because a production install behind a plain-http reverse proxy
 * would otherwise be given a cookie the browser drops without a word.
 *
 * It lives here rather than in auth.ts because two files need the answer and
 * they must not be able to disagree: auth.ts sets the flag when it issues the
 * cookie, and session-registry.ts reads the cookie back by name. A second copy
 * that consulted one more environment variable would look for a cookie under
 * a name nothing had issued, find nothing, and silently fail open on exactly
 * the deployments that run over https.
 */
export const SECURE_SESSION_COOKIES =
    (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "").startsWith("https://");

/**
 * A word that keeps two installations on one host apart.
 *
 * A cookie belongs to a domain and ignores the port, so two installations on
 * one machine - a staging site beside a live one, which is the ordinary shape
 * of it - issue the same three cookie names at the same domain and overwrite
 * each other. Signing into one signs you out of the other, which reads as a
 * session bug rather than as two sites sharing a jar. Measured on this
 * machine: both servers answered `/api/auth/csrf` with `authjs.csrf-token` and
 * `authjs.callback-url`.
 *
 * Empty by default, so an installation that has never heard of this keeps the
 * names it has been issuing and nobody is signed out by an upgrade. The word
 * goes after `__Secure-` and `__Host-`, because a browser reads those prefixes
 * at the very start of the name or not at all.
 */
const COOKIE_NAMESPACE = (process.env.AUTH_COOKIE_NAMESPACE ?? "").trim().replace(/[^a-zA-Z0-9-]/g, "");
const NAMESPACED = COOKIE_NAMESPACE ? `${COOKIE_NAMESPACE}.` : "";

/** The name the session token is issued under, prefix and all. */
export const SESSION_TOKEN_COOKIE = SECURE_SESSION_COOKIES
    ? `__Secure-${NAMESPACED}authjs.session-token`
    : `${NAMESPACED}authjs.session-token`;

const SESSION_COOKIE_NAMES = [
    "authjs.session-token",
    "next-auth.session-token",
];

const PREFIXES = ["", "__Secure-", "__Host-"];

/**
 * Built from the name this installation actually issues as well as the
 * historical ones.
 *
 * The list used to be the historical names alone. Once a deployment can put a
 * word in front of them to keep two installations apart, a fixed list stops
 * matching what it hands out: this would answer "no session cookie" for every
 * request on exactly the deployments that set one, and fail open on the
 * caller that trusts a false.
 */
const SESSION_NAMES = new Set([
    ...PREFIXES.flatMap((prefix) => SESSION_COOKIE_NAMES.map((name) => prefix + name)),
    SESSION_TOKEN_COOKIE,
]);


/** Where a sign-in returns to. Same jar, so the same word keeps it apart. */
export const CALLBACK_URL_COOKIE = SECURE_SESSION_COOKIES
    ? `__Secure-${NAMESPACED}authjs.callback-url`
    : `${NAMESPACED}authjs.callback-url`;

/**
 * The CSRF token. `__Host-` rather than `__Secure-`: it is the one of the
 * three that must not be settable by a sibling domain.
 */
export const CSRF_TOKEN_COOKIE = SECURE_SESSION_COOKIES
    ? `__Host-${NAMESPACED}authjs.csrf-token`
    : `${NAMESPACED}authjs.csrf-token`;



export function carriesSessionCookie(cookieHeader: string | null | undefined): boolean {
    if (!cookieHeader) return false;

    for (const pair of cookieHeader.split(";")) {
        const eq = pair.indexOf("=");
        if (eq === -1) continue;
        // An empty value is how a sign-out looks: the server clears the cookie
        // by sending the same name with nothing in it.
        if (!pair.slice(eq + 1).trim()) continue;
        if (SESSION_NAMES.has(pair.slice(0, eq).trim())) return true;
    }
    return false;
}
