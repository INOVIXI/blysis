// @vitest-environment node
/**
 * A lockout an operator can shape, and a member they can let back in.
 *
 * Progressive lockout has three numbers: how many wrong passwords it takes,
 * how long they are counted over, and how long the account then stays shut.
 * Measured on 2026-09-20, only the first was an operator's to set, and
 * `account-lockout.ts` said so in its own words: "The window and the lock
 * duration stay environment-only, because neither has a screen offering to
 * change it." So a site wanting a ten minute window and an hour's lock had to
 * be redeployed.
 *
 * Worse, `lockedUntil` was read in exactly one file and written in the same
 * one. Nothing showed an operator who was locked out and nothing could let
 * them back in: a member who fat-fingered their password ten times waited it
 * out, and the person they wrote to had no way to help.
 *
 * Both numbers fall back the way the threshold already did - the setting, then
 * the environment variable an install sets once, then the built-in - so
 * nothing has to run for a site that never opens the screen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows = new Map<string, unknown>();
const users = new Map<string, Record<string, unknown>>();
const updates: { where: unknown; data: Record<string, unknown> }[] = [];

vi.mock("@/core/lib/db", () => ({
    prisma: {
        setting: {
            findUnique: async ({ where }: { where: { key: string } }) =>
                (rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null),
        },
        user: {
            findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
            findMany: async (args: Record<string, unknown>) => {
                const where = (args.where ?? {}) as { lockedUntil?: { gt?: Date } };
                const after = where.lockedUntil?.gt;
                return [...users.values()].filter((u) => {
                    const until = u.lockedUntil as Date | null;
                    return after ? !!until && until.getTime() > after.getTime() : true;
                });
            },
            update: async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
                updates.push({ where, data });
                return { id: "u1" };
            },
        },
    },
}));
vi.mock("@/core/lib/logger", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    errorText: (e: unknown) => String(e),
}));

const { LOCKOUT_WINDOW, LOCKOUT_DURATION } = await import("@/core/lib/security-settings");
const { getDurationMs } = await import("@/core/lib/security-settings");
const { lockedAccounts, unlockAccount } = await import("@/core/lib/account-lockout");

beforeEach(() => {
    rows.clear();
    users.clear();
    updates.length = 0;
});

describe("how long wrong passwords are counted over", () => {
    it("is a quarter of an hour on a site that never said", async () => {
        expect(await getDurationMs(LOCKOUT_WINDOW)).toBe(15 * 60_000);
    });

    it("is what the operator set", async () => {
        rows.set(LOCKOUT_WINDOW.key, 10);
        expect(await getDurationMs(LOCKOUT_WINDOW)).toBe(10 * 60_000);
    });

    it("is never nothing, because a window of zero locks on one typo", async () => {
        rows.set(LOCKOUT_WINDOW.key, 0);
        expect(await getDurationMs(LOCKOUT_WINDOW)).toBe(LOCKOUT_WINDOW.min * 60_000);
    });

    it("is never a row of nonsense", async () => {
        rows.set(LOCKOUT_WINDOW.key, "a fortnight");
        expect(await getDurationMs(LOCKOUT_WINDOW)).toBe(15 * 60_000);
    });
});

describe("how long the account then stays shut", () => {
    it("is a quarter of an hour on a site that never said", async () => {
        expect(await getDurationMs(LOCKOUT_DURATION)).toBe(15 * 60_000);
    });

    it("is what the operator set", async () => {
        rows.set(LOCKOUT_DURATION.key, 60);
        expect(await getDurationMs(LOCKOUT_DURATION)).toBe(60 * 60_000);
    });

    it("has a ceiling, because a lock nobody can lift is a deleted account", async () => {
        rows.set(LOCKOUT_DURATION.key, 100_000);
        expect(await getDurationMs(LOCKOUT_DURATION)).toBe(LOCKOUT_DURATION.max * 60_000);
    });
});

describe("who is locked out right now", () => {
    it("is nobody on a site where nobody is", async () => {
        users.set("u1", { id: "u1", username: "aeryn", lockedUntil: null });
        expect(await lockedAccounts()).toEqual([]);
    });

    it("is whoever is still inside their lock", async () => {
        const soon = new Date(Date.now() + 5 * 60_000);
        users.set("u1", { id: "u1", username: "aeryn", email: "a@example.invalid", lockedUntil: soon, failedLoginAttempts: 10, lastFailedLoginAt: new Date() });
        const locked = await lockedAccounts();
        expect(locked).toHaveLength(1);
        expect(locked[0]).toMatchObject({ id: "u1", username: "aeryn", attempts: 10 });
        expect(locked[0].lockedUntil.getTime()).toBe(soon.getTime());
    });

    it("is not somebody whose lock has already lifted", async () => {
        users.set("u1", { id: "u1", username: "aeryn", lockedUntil: new Date(Date.now() - 60_000) });
        expect(await lockedAccounts()).toEqual([]);
    });
});

describe("letting somebody back in", () => {
    it("lifts the lock and forgets the failures with it", async () => {
        await unlockAccount("u1");
        expect(updates).toHaveLength(1);
        expect(updates[0].data).toEqual({
            failedLoginAttempts: 0,
            lastFailedLoginAt: null,
            lockedUntil: null,
        });
    });

    it("is the same act as a successful sign-in, so there is one way back", async () => {
        const { resetFailedLogins } = await import("@/core/lib/account-lockout");
        await resetFailedLogins("u1");
        await unlockAccount("u1");
        expect(updates[0].data).toEqual(updates[1].data);
    });
});
