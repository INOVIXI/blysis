import { hasControlCharacter } from "@/core/lib/request-path";

/**
 * "Where were you going?" - kept, but only if it points back here.
 *
 * A signed-out visitor who opens a bookmarked deep link is sent to the login
 * form, and the form has to be told where they were headed. That destination
 * arrives as a query parameter, which means it arrives from whoever wrote the
 * link. Handing it straight to `router.push` turns the login page into an open
 * redirect: `/auth/login?callbackUrl=//evil.example` sends a person who has
 * just typed their password to somebody else's site, still believing they are
 * on this one.
 *
 * So a destination is accepted only when it is unmistakably a path on this
 * site, and rejected otherwise - the caller falls back to the homepage rather
 * than to a guess.
 *
 * The rules, and why each one is here:
 *
 *  - It must start with `/`. Anything else is a scheme, a host, or a relative
 *    fragment, and none of those is a page of ours.
 *  - The character after it may not be `/` or a backslash. `//evil.example` is
 *    a protocol-relative URL, and a browser folds a backslash into a slash
 *    before resolving, so the same trick has a second spelling. Both are
 *    judged after folding, not before.
 *  - No control characters, on the same terms as `hasControlCharacter` refuses
 *    them in a request path.
 *  - Not the login page itself, which would bounce a person who has just
 *    signed in straight back to the form they came from.
 *  - A length ceiling, because a destination longer than any real route on the
 *    site is a payload rather than a place.
 *
 * The path is returned without a locale prefix, the way
 * `@/core/lib/i18n/navigation` hrefs are written everywhere else, so the
 * caller's router adds the visitor's own locale rather than whichever one the
 * link was copied from.
 */

const MAX_LENGTH = 512;

export function safeInternalPath(raw: string | null | undefined): string | null {
    if (!raw) return null;
    if (raw.length > MAX_LENGTH) return null;
    if (hasControlCharacter(raw)) return null;

    const folded = raw.replace(/\\/g, "/");
    if (!folded.startsWith("/")) return null;
    if (folded.startsWith("//")) return null;

    // The path decides whether this is the login form; a query string must not
    // be able to disguise it.
    const path = folded.split(/[?#]/)[0];
    if (path === "/auth/login" || path.startsWith("/auth/login/")) return null;

    return folded;
}
