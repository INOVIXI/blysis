/**
 * How long a signed-in session lasts.
 *
 * Auth.js gets one `session.maxAge`, which sets both the cookie's lifetime and
 * the JWT's own expiry, and it is read once when the process starts. The
 * lifetimes an operator sets on Admin > Settings > General change while it
 * runs, so the cookie is issued at the longest lifetime a setting can reach
 * and the one that applies is stamped onto the token as an absolute deadline
 * that the `jwt` callback enforces on every request. A token past its
 * deadline is dropped the same way a banned user's is.
 *
 * Absolute by default: a session that started a day ago on a shared machine
 * ends, however much it was used in between. An operator may turn on renewal,
 * which moves the deadline forward while the member keeps using the site. The
 * deadline then measures inactivity rather than age, so a tab left open on a
 * shared machine still ends once nobody has used it for a whole lifetime.
 *
 * The renewed deadline is kept on the session's row, not only on the token:
 * Auth.js writes the cookie back from its own handlers only, so a deadline
 * moved on an ordinary request would never reach the browser.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Hours a session lasts when the member did not ask to stay signed in. */
export const SESSION_LIFETIME_HOURS = { key: "session_lifetime_hours", defaultValue: 24, min: 1, max: 720 } as const;

/** Days a session lasts when the member ticked "keep me signed in". */
export const REMEMBERED_LIFETIME_DAYS = { key: "session_remembered_days", defaultValue: 30, min: 1, max: 365 } as const;

/** Whether activity moves a session's deadline forward. Off unless the row says "true". */
export const SESSION_RENEWAL_KEY = "session_renew_on_activity";

/**
 * Whether a sign-in through a provider (Discord, Google and the like) is kept
 * as long as a remembered one. Those sign-ins have no checkbox to tick, so
 * without this they always take the short lifetime.
 */
export const PROVIDER_SIGN_IN_REMEMBERED_KEY = "session_provider_remembered";

/**
 * The cookie outlives every lifetime a setting can choose, so a longer
 * remembered lifetime saved later is not cut short by a cookie issued earlier.
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = REMEMBERED_LIFETIME_DAYS.max * 24 * 60 * 60;

export interface SessionPolicy {
    /** Milliseconds a session lasts when not remembered. */
    shortMs: number;
    /** Milliseconds a remembered session lasts. */
    rememberedMs: number;
    /** Whether activity moves the deadline forward. */
    renew: boolean;
    /** Whether a provider sign-in counts as remembered. */
    providerRemembered: boolean;
}

/** What a site that never opened the settings screen gets. */
export const DEFAULT_SESSION_POLICY: SessionPolicy = {
    shortMs: SESSION_LIFETIME_HOURS.defaultValue * HOUR_MS,
    rememberedMs: REMEMBERED_LIFETIME_DAYS.defaultValue * DAY_MS,
    renew: false,
    providerRemembered: false,
};

function clampWhole(raw: unknown, bounds: { defaultValue: number; min: number; max: number }): number {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : Number.NaN;
    if (!Number.isFinite(n)) return bounds.defaultValue;
    return Math.min(bounds.max, Math.max(bounds.min, Math.floor(n)));
}

function isYes(raw: unknown): boolean {
    return raw === true || raw === "true";
}

/**
 * The policy the stored rows describe. A missing or unusable row reads as the
 * default rather than throwing, because a settings row is not a reason for
 * nobody to be able to stay signed in.
 */
export function sessionPolicyFrom(values: Record<string, unknown>): SessionPolicy {
    return {
        shortMs: clampWhole(values[SESSION_LIFETIME_HOURS.key], SESSION_LIFETIME_HOURS) * HOUR_MS,
        rememberedMs: clampWhole(values[REMEMBERED_LIFETIME_DAYS.key], REMEMBERED_LIFETIME_DAYS) * DAY_MS,
        renew: isYes(values[SESSION_RENEWAL_KEY]),
        providerRemembered: isYes(values[PROVIDER_SIGN_IN_REMEMBERED_KEY]),
    };
}

/**
 * Reads the checkbox off the credentials payload.
 *
 * Everything crossing the Auth.js credentials boundary arrives as a string,
 * and anything that is not an explicit yes is a no.
 */
export function parseRemember(raw: unknown): boolean {
    if (typeof raw === "boolean") return raw;
    if (typeof raw !== "string") return false;
    const value = raw.trim().toLowerCase();
    return value === "true" || value === "1" || value === "on" || value === "yes";
}

/** Epoch milliseconds at which a session minted (or last renewed) now stops working. */
export function sessionExpiresAt(policy: SessionPolicy, remember: boolean, now: number = Date.now()): number {
    return now + (remember ? policy.rememberedMs : policy.shortMs);
}

/**
 * True when a token has passed its stamped deadline.
 *
 * A token with no deadline was issued before this existed; it keeps working
 * until its own cookie expires rather than logging everyone out on deploy.
 */
export function sessionExpired(
    token: { absoluteExpiry?: unknown } | null | undefined,
    now: number = Date.now(),
): boolean {
    const expiry = token?.absoluteExpiry;
    if (typeof expiry !== "number" || !Number.isFinite(expiry)) return false;
    return now >= expiry;
}

/**
 * The deadline a session past its stamped one may still be held to, from the
 * row renewal keeps. Null means the session is over: renewal is off, the row
 * is gone or revoked, or the member was away longer than a lifetime.
 */
export function renewedDeadline(
    policy: SessionPolicy,
    row: { expiresAt: Date; isRevoked: boolean } | null,
    now: number = Date.now(),
): number | null {
    if (!policy.renew || !row || row.isRevoked) return null;
    const deadline = row.expiresAt.getTime();
    return deadline > now ? deadline : null;
}
