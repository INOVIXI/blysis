import { describe, it, expect } from "vitest";
import {
    DEFAULT_SESSION_POLICY,
    PROVIDER_SIGN_IN_REMEMBERED_KEY,
    REMEMBERED_LIFETIME_DAYS,
    SESSION_COOKIE_MAX_AGE_SECONDS,
    SESSION_LIFETIME_HOURS,
    SESSION_RENEWAL_KEY,
    parseRemember,
    rememberedSession,
    renewedDeadline,
    sessionExpired,
    sessionExpiresAt,
    sessionPolicyFrom,
} from "@/core/lib/session-lifetime";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const POLICY = DEFAULT_SESSION_POLICY;

describe("parseRemember", () => {
    it("accepts the values a checkbox can arrive as", () => {
        for (const raw of ["true", "1", "on", "yes", "TRUE", " True ", true]) {
            expect(parseRemember(raw), String(raw)).toBe(true);
        }
    });

    it("treats anything else as not remembered", () => {
        for (const raw of ["false", "0", "off", "", "  ", undefined, null, 1, {}]) {
            expect(parseRemember(raw), String(raw)).toBe(false);
        }
    });
});

describe("sessionExpiresAt", () => {
    it("gives an un-remembered session the short lifetime", () => {
        expect(sessionExpiresAt(POLICY, false, NOW)).toBe(NOW + 24 * HOUR);
    });

    it("gives a remembered session the long one", () => {
        expect(sessionExpiresAt(POLICY, true, NOW)).toBe(NOW + 30 * DAY);
    });

    it("keeps the remembered lifetime longer than the default", () => {
        expect(POLICY.rememberedMs).toBeGreaterThan(POLICY.shortMs);
    });

    it("uses the lifetimes the operator chose", () => {
        const policy = sessionPolicyFrom({ [SESSION_LIFETIME_HOURS.key]: 72, [REMEMBERED_LIFETIME_DAYS.key]: "90" });
        expect(sessionExpiresAt(policy, false, NOW)).toBe(NOW + 72 * HOUR);
        expect(sessionExpiresAt(policy, true, NOW)).toBe(NOW + 90 * DAY);
    });
});

describe("sessionPolicyFrom", () => {
    it("is the default for a site that never saved the settings", () => {
        expect(sessionPolicyFrom({})).toEqual(DEFAULT_SESSION_POLICY);
        expect(DEFAULT_SESSION_POLICY.renew).toBe(false);
        expect(DEFAULT_SESSION_POLICY.providerRemembered).toBe(false);
    });

    it("reads an unusable lifetime as the default and holds the rest to its bounds", () => {
        expect(sessionPolicyFrom({ [SESSION_LIFETIME_HOURS.key]: "soon" }).shortMs).toBe(24 * HOUR);
        expect(sessionPolicyFrom({ [SESSION_LIFETIME_HOURS.key]: 0 }).shortMs).toBe(HOUR);
        expect(sessionPolicyFrom({ [SESSION_LIFETIME_HOURS.key]: 100_000 }).shortMs).toBe(720 * HOUR);
        expect(sessionPolicyFrom({ [REMEMBERED_LIFETIME_DAYS.key]: 10_000 }).rememberedMs).toBe(365 * DAY);
    });

    it("turns renewal and provider sign-ins on only for an explicit yes", () => {
        expect(sessionPolicyFrom({ [SESSION_RENEWAL_KEY]: "true" }).renew).toBe(true);
        expect(sessionPolicyFrom({ [SESSION_RENEWAL_KEY]: true }).renew).toBe(true);
        expect(sessionPolicyFrom({ [SESSION_RENEWAL_KEY]: "yes" }).renew).toBe(false);
        expect(sessionPolicyFrom({ [PROVIDER_SIGN_IN_REMEMBERED_KEY]: "true" }).providerRemembered).toBe(true);
        expect(sessionPolicyFrom({ [PROVIDER_SIGN_IN_REMEMBERED_KEY]: "false" }).providerRemembered).toBe(false);
    });

    it("never chooses a lifetime the cookie does not outlive", () => {
        const longest = sessionPolicyFrom({ [REMEMBERED_LIFETIME_DAYS.key]: Number.MAX_SAFE_INTEGER });
        expect(longest.rememberedMs).toBeLessThanOrEqual(SESSION_COOKIE_MAX_AGE_SECONDS * 1000);
        const shortest = sessionPolicyFrom({ [SESSION_LIFETIME_HOURS.key]: Number.MAX_SAFE_INTEGER });
        expect(shortest.shortMs).toBeLessThanOrEqual(SESSION_COOKIE_MAX_AGE_SECONDS * 1000);
    });
});

describe("renewedDeadline", () => {
    const renewing = { ...POLICY, renew: true };
    const live = { expiresAt: new Date(NOW + HOUR), isRevoked: false };

    it("holds a session to the deadline its row was moved to", () => {
        expect(renewedDeadline(renewing, live, NOW)).toBe(NOW + HOUR);
    });

    it("ends the session when renewal is off, whatever the row says", () => {
        expect(renewedDeadline(POLICY, live, NOW)).toBeNull();
    });

    it("ends a revoked session, and one with no row", () => {
        expect(renewedDeadline(renewing, { ...live, isRevoked: true }, NOW)).toBeNull();
        expect(renewedDeadline(renewing, null, NOW)).toBeNull();
    });

    it("ends a session nobody used for a whole lifetime", () => {
        expect(renewedDeadline(renewing, live, NOW + HOUR)).toBeNull();
    });
});

describe("sessionExpired", () => {
    it("is false before the deadline and true at or after it", () => {
        const expiry = sessionExpiresAt(POLICY, false, NOW);
        expect(sessionExpired({ absoluteExpiry: expiry }, expiry - 1)).toBe(false);
        expect(sessionExpired({ absoluteExpiry: expiry }, expiry)).toBe(true);
        expect(sessionExpired({ absoluteExpiry: expiry }, expiry + 1)).toBe(true);
    });

    it("lets tokens issued before the field existed keep working", () => {
        expect(sessionExpired({}, NOW)).toBe(false);
        expect(sessionExpired(null, NOW)).toBe(false);
        expect(sessionExpired(undefined, NOW)).toBe(false);
    });

    it("ignores a deadline that is not a usable number", () => {
        expect(sessionExpired({ absoluteExpiry: "soon" }, NOW)).toBe(false);
        expect(sessionExpired({ absoluteExpiry: Number.NaN }, NOW)).toBe(false);
        expect(sessionExpired({ absoluteExpiry: Number.POSITIVE_INFINITY }, NOW)).toBe(false);
    });
});

describe("rememberedSession", () => {
    const policy = { ...DEFAULT_SESSION_POLICY, shortMs: 24 * 3_600_000, rememberedMs: 30 * 86_400_000 };
    const now = Date.UTC(2026, 10, 23, 12);

    it("takes the token's own word when it has one", () => {
        expect(rememberedSession({ remembered: true, absoluteExpiry: now + 1_000 }, policy, now)).toBe(true);
        expect(rememberedSession({ remembered: false, absoluteExpiry: now + 20 * 86_400_000 }, policy, now)).toBe(false);
    });

    it("keeps a session minted before the claim remembered when its deadline says it was", () => {
        // Signed in with "remember me" before tokens carried the claim: the
        // deadline is weeks away, which a short session can never be.
        expect(rememberedSession({ absoluteExpiry: now + 20 * 86_400_000 }, policy, now)).toBe(true);
    });

    it("leaves a short one short, and one with no deadline at all", () => {
        expect(rememberedSession({ absoluteExpiry: now + 3_600_000 }, policy, now)).toBe(false);
        expect(rememberedSession({}, policy, now)).toBe(false);
    });
});
