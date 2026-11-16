// @vitest-environment node
/**
 * A session past its deadline costs no database read on a site that does not
 * renew sessions.
 *
 * Renewal keeps a moved deadline on the session's row, so a token past the
 * deadline it carries is asked about there. The row was read before the
 * policy was looked at, so on every site, renewal on or off, a browser still
 * holding an ended session paid a row read on each request, where before the
 * setting existed the token was dropped without one. Renewal is off by
 * default, which made that every site that never opened the setting.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let stored: Record<string, unknown> = {};
const sessionDeadline = vi.fn(async () => ({ expiresAt: new Date(Date.now() + 60_000), isRevoked: false }));

vi.mock("@/core/lib/cache", () => ({ cached: async (_key: string, _ms: number, read: () => unknown) => read() }));
vi.mock("@/core/lib/setting-values", () => ({ readSettingValues: async () => stored }));
vi.mock("@/core/lib/session-registry", () => ({ sessionDeadline }));

const { deadlineAfterExpiry } = await import("@/core/lib/session-policy");

beforeEach(() => {
    stored = {};
    sessionDeadline.mockClear();
});

describe("a token past its deadline", () => {
    it("ends without a row read when renewal is off", async () => {
        await expect(deadlineAfterExpiry("t1")).resolves.toBeNull();
        expect(sessionDeadline).not.toHaveBeenCalled();
    });

    it("is held to the row's deadline when renewal is on", async () => {
        stored = { session_renew_on_activity: "true" };
        await expect(deadlineAfterExpiry("t1")).resolves.toBeGreaterThan(Date.now());
        expect(sessionDeadline).toHaveBeenCalledWith("t1");
    });
});
