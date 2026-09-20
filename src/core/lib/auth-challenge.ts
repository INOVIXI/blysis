/**
 * The gate a module can put in front of signing in and signing up.
 *
 * Core has no CAPTCHA, no bot score and no opinion about either, and it must
 * not grow one: the whole point of this platform is that the interesting
 * behaviour arrives as a module. But a module cannot add a check to the
 * login form on its own - it has nowhere to draw the widget and nowhere to
 * refuse the request.
 *
 * So core provides both halves and knows nothing about what fills them:
 *
 *   - a slot, `auth.form.challenge`, rendered inside the login, register and
 *     forgot-password forms. Whatever a module draws there receives an
 *     `onField(name, value)` callback and reports whatever it needs sent.
 *   - a filter, `auth.challenge`, run on the server before the credentials
 *     are checked or the account is created. It carries the fields the slot
 *     reported, the action they belong to, and the caller's IP. A listener
 *     returns `{ ok: false, code }` to refuse.
 *
 * With no module installed the slot renders nothing, the filter has no
 * listeners, and `runChallenge` returns the value it was given. The
 * three forms behave exactly as they did.
 *
 * The names the browser also needs - the field, the action union, the
 * parser - live in `auth-challenge-shared.ts`, because everything this
 * file reaches is server-only. See that file for why.
 *
 * `code` follows the auth error contract: the client looks up `auth.err.<code>`
 * and falls back to a generic message when the key is missing, so a module
 * can return a code core has never heard of and still get a sentence in the
 * user's language if it ships the key itself.
 */

import { CHALLENGE_PASSED, type AuthChallengeAction, type AuthChallengeResult } from "./auth-challenge-shared";

/**
 * Ask every listener whether this attempt may proceed.
 *
 * The import is dynamic so the hook bus - and everything a listener drags in
 * with it - stays out of the Auth.js edge bundle until something is actually
 * registered.
 */
export async function runChallenge(context: {
    action: AuthChallengeAction;
    fields: Record<string, string>;
    ip: string | null;
}): Promise<AuthChallengeResult> {
    try {
        const { applyFiltersAsync } = await import("./hooks");
        return await applyFiltersAsync("auth.challenge", CHALLENGE_PASSED, context);
    } catch {
        // A listener that throws must not lock everyone out of the site.
        // Refusing here would turn a broken module into an outage; the
        // failure is logged by the hook bus itself.
        return CHALLENGE_PASSED;
    }
}
