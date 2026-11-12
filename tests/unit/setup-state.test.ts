import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Setup state gates every request on a fresh install. Two failure modes
 * matter and neither was covered: reporting "not complete" on an
 * installed site drops every visitor into the setup wizard, and a
 * database outage must not do that either - hence the deliberate
 * fail-safe that returns true when the count query throws.
 */

const { user } = vi.hoisted(() => ({ user: { count: vi.fn() } }));

vi.mock("@/core/lib/db", () => ({ default: { user }, prisma: { user } }));

import {
    isSetupComplete,
    markSetupComplete,
    resetSetupStateForTesting,
} from "@/core/lib/setup-state";

beforeEach(() => {
    user.count.mockReset().mockResolvedValue(0);
    resetSetupStateForTesting();
});

afterEach(() => {
    vi.useRealTimers();
    resetSetupStateForTesting();
});

describe("isSetupComplete", () => {
    it("is false on a fresh install with no users", async () => {
        await expect(isSetupComplete()).resolves.toBe(false);
    });

    it("is true once a user exists", async () => {
        user.count.mockResolvedValue(1);
        await expect(isSetupComplete()).resolves.toBe(true);
    });

    it("latches, so a later database wobble cannot un-install the site", async () => {
        user.count.mockResolvedValue(1);
        await isSetupComplete();

        user.count.mockRejectedValue(new Error("db down"));
        await expect(isSetupComplete()).resolves.toBe(true);
        // The latch short-circuits before the query is even attempted.
        expect(user.count).toHaveBeenCalledTimes(1);
    });

    it("fails safe to true when the database is unreachable", async () => {
        user.count.mockRejectedValue(new Error("db down"));

        // Returning false here would trap visitors in an inescapable wizard.
        await expect(isSetupComplete()).resolves.toBe(true);
    });

    it("does not latch on a failed check, so recovery is still detected", async () => {
        user.count.mockRejectedValueOnce(new Error("db down"));
        await isSetupComplete();

        resetSetupStateForTesting();
        user.count.mockResolvedValue(0);
        await expect(isSetupComplete()).resolves.toBe(false);
    });

    it("answers every request that arrives while the first check is in flight with that check's answer", async () => {
        // A restart: the first request starts the count, and the requests that
        // arrive before it returns used to be told "not complete" by the
        // throttle and were sent to the setup wizard of an installed site.
        let answer: (n: number) => void = () => {};
        user.count.mockReturnValue(new Promise<number>((resolve) => { answer = resolve; }));

        const first = isSetupComplete();
        const second = isSetupComplete();
        const third = isSetupComplete();
        answer(70_000);

        await expect(Promise.all([first, second, third])).resolves.toEqual([true, true, true]);
        expect(user.count).toHaveBeenCalledTimes(1);
    });

    it("keeps failing safe inside the throttle window after the database was unreachable", async () => {
        user.count.mockRejectedValue(new Error("db down"));
        await isSetupComplete();

        // The throttle used to answer false here, so the request after an
        // outage sent visitors of an installed site to the wizard.
        await expect(isSetupComplete()).resolves.toBe(true);
        expect(user.count).toHaveBeenCalledTimes(1);
    });

    it("throttles repeat checks for ten seconds while incomplete", async () => {
        await isSetupComplete();
        await isSetupComplete();
        await isSetupComplete();

        expect(user.count).toHaveBeenCalledTimes(1);
    });

    it("re-checks once the throttle window has passed", async () => {
        vi.useFakeTimers();
        await isSetupComplete();

        vi.setSystemTime(Date.now() + 10_001);
        user.count.mockResolvedValue(1);

        await expect(isSetupComplete()).resolves.toBe(true);
        expect(user.count).toHaveBeenCalledTimes(2);
    });

    it("still throttles just inside the window", async () => {
        vi.useFakeTimers();
        await isSetupComplete();

        vi.setSystemTime(Date.now() + 9_999);
        user.count.mockResolvedValue(1);

        await expect(isSetupComplete()).resolves.toBe(false);
        expect(user.count).toHaveBeenCalledTimes(1);
    });
});

describe("markSetupComplete", () => {
    it("flips the latch without a database round trip", async () => {
        markSetupComplete();

        await expect(isSetupComplete()).resolves.toBe(true);
        expect(user.count).not.toHaveBeenCalled();
    });
});

describe("resetSetupStateForTesting", () => {
    it("clears the latch and the throttle", async () => {
        markSetupComplete();
        resetSetupStateForTesting();

        await expect(isSetupComplete()).resolves.toBe(false);
        expect(user.count).toHaveBeenCalledTimes(1);
    });
});
