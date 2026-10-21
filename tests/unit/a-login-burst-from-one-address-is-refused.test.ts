/**
 * What stops one address trying one password against every account.
 *
 * The lockout this product ships counts against the *account*: five wrong
 * passwords for one user and that user is locked. That is the right defence
 * against someone guessing one person's password and no defence at all against
 * the opposite shape, which is the common one. An attacker with a list of
 * addresses and a list of the passwords people actually use tries each
 * password once per account, never reaches any account's threshold, and walks
 * through the front door of whichever account used it.
 *
 * Measured against a production build before this existed: forty sign-in
 * attempts from one address against forty different accounts, and all forty
 * were served. Nothing counted them and nothing refused.
 *
 * Only failures count. A shared address is normal - an office, a school, a
 * mobile carrier's NAT, a household - and a ceiling that counts successful
 * sign-ins would lock those users out of a site that is working perfectly.
 * What is being bounded is guessing, and a guess that was right is not one.
 *
 * The address itself is only as trustworthy as the deployment: with no
 * TRUSTED_PROXY_IPS set, the caller writes their own forwarded header and can
 * buy a fresh budget by changing it. That is already true of every limit here
 * and is warned about at boot. It raises the cost of the naive attack, which
 * is the one that actually arrives.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
    LOGIN_FAILURES_PER_ADDRESS,
    loginAllowedFrom,
    noteFailedLoginFrom,
    forgetLoginFailures,
} from "@/core/lib/login-throttle";

const ADDRESS = "203.0.113.7";

beforeEach(() => {
    forgetLoginFailures();
});

describe("an address that has not been guessing", () => {
    it("is allowed", async () => {
        await expect(loginAllowedFrom(ADDRESS)).resolves.toBe(true);
    });

    it("is still allowed after a successful sign-in", async () => {
        // Nothing is counted on the way in, so signing in a hundred times
        // from an office does not spend anybody's budget.
        for (let i = 0; i < 100; i++) {
            expect(await loginAllowedFrom(ADDRESS)).toBe(true);
        }
    });
});

describe("an address that has been guessing", () => {
    it("is allowed right up to the ceiling", async () => {
        for (let i = 0; i < LOGIN_FAILURES_PER_ADDRESS; i++) {
            expect(await loginAllowedFrom(ADDRESS), `attempt ${i + 1}`).toBe(true);
            await noteFailedLoginFrom(ADDRESS);
        }
    });

    it("is refused past it", async () => {
        // The ceiling is per address across all accounts, which is the whole
        // point: forty accounts tried once each must reach it. Nothing here
        // names an account, so there is no per-account count to fall back on.
        for (let i = 0; i < LOGIN_FAILURES_PER_ADDRESS; i++) {
            await noteFailedLoginFrom(ADDRESS);
        }
        await expect(loginAllowedFrom(ADDRESS)).resolves.toBe(false);
    });

    it("does not spend anybody else's budget", async () => {
        for (let i = 0; i < LOGIN_FAILURES_PER_ADDRESS * 2; i++) {
            await noteFailedLoginFrom(ADDRESS);
        }
        await expect(loginAllowedFrom("198.51.100.4")).resolves.toBe(true);
    });
});

describe("an address the deployment cannot name", () => {
    it("is allowed, rather than sharing one bucket with everybody", async () => {
        // Behind a proxy that strips the header, every caller looks the same.
        // Counting them together would let one guesser lock out the whole
        // site, which is a worse failure than the one being prevented.
        for (let i = 0; i < LOGIN_FAILURES_PER_ADDRESS * 3; i++) {
            await noteFailedLoginFrom("");
        }
        await expect(loginAllowedFrom("")).resolves.toBe(true);
    });
});
