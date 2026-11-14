/**
 * The session lifetimes an operator chose, read through the cache.
 *
 * The `jwt` callback runs on every request, but it asks for the policy only
 * at a sign-in, at a recheck and when a token has passed its deadline, so a
 * short cache keeps that to one settings read a minute at most. Saving the
 * settings drops the entry (`SESSION_POLICY_CACHE_KEY` in the settings
 * route), so a new lifetime applies to the next sign-in straight away.
 */
import { cached } from "./cache";
import { readSettingValues } from "./setting-values";
import { log, errorText } from "./logger";
import {
    DEFAULT_SESSION_POLICY,
    PROVIDER_SIGN_IN_REMEMBERED_KEY,
    REMEMBERED_LIFETIME_DAYS,
    SESSION_LIFETIME_HOURS,
    SESSION_RENEWAL_KEY,
    sessionPolicyFrom,
    type SessionPolicy,
} from "./session-lifetime";

export const SESSION_POLICY_CACHE_KEY = "blysis:session-policy";

const CACHE_MS = 60_000;

const KEYS = [
    SESSION_LIFETIME_HOURS.key,
    REMEMBERED_LIFETIME_DAYS.key,
    SESSION_RENEWAL_KEY,
    PROVIDER_SIGN_IN_REMEMBERED_KEY,
];

export async function getSessionPolicy(): Promise<SessionPolicy> {
    try {
        return await cached(SESSION_POLICY_CACHE_KEY, CACHE_MS, async () =>
            sessionPolicyFrom(await readSettingValues(KEYS)),
        );
    } catch (err) {
        // A settings read must never sign everybody out. The defaults are the
        // lifetimes every site had before these settings existed.
        log.error("[sessions] could not read the session settings", { error: errorText(err) });
        return DEFAULT_SESSION_POLICY;
    }
}
