// @vitest-environment node
/**
 * Keeping "last active" fresh must not cost a write a minute per session.
 *
 * The stamp is refreshed inside the `jwt` callback's recheck branch. That is
 * the right place and the wrong rate: one update per signed-in session per
 * minute per worker is 1,667 writes a second at a hundred thousand active
 * sessions, all of them saying what the previous minute already said.
 *
 * What the screen needs is coarse: "last active" is rendered as a date and a
 * time, and nobody reads it to the minute. So the worker skips the write until
 * its own interval has passed - see `session-check-memo.ts`, which is where a
 * stamp survives in this app - and the statement carries the same condition,
 * so the workers that did not skip do not all write the same row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
    tokenId: string;
    userId: string;
    lastActiveAt: Date;
    expiresAt: Date;
    isRevoked: boolean;
}

const rows: Row[] = [];
const writes: { tokenId: string; count: number }[] = [];

const userSession = {
    create: async ({ data }: { data: { tokenId: string; userId: string; expiresAt: Date } }) => {
        const row: Row = { ...data, lastActiveAt: new Date(), isRevoked: false };
        rows.push(row);
        return row;
    },
    updateMany: async ({ where, data }: {
        where: { tokenId: string; lastActiveAt?: { lt: Date } };
        data: { lastActiveAt: Date; expiresAt?: Date };
    }) => {
        const hit = rows.filter(
            (r) =>
                r.tokenId === where.tokenId &&
                (where.lastActiveAt === undefined || r.lastActiveAt.getTime() < where.lastActiveAt.lt.getTime()),
        );
        for (const r of hit) Object.assign(r, data);
        writes.push({ tokenId: where.tokenId, count: hit.length });
        return { count: hit.length };
    },
};

vi.mock("@/core/lib/db", () => ({ prisma: { userSession }, default: { userSession } }));
vi.mock("@/core/lib/logger", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const { touchSession, SESSION_TOUCH_INTERVAL_MS } = await import("@/core/lib/session-registry");

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

beforeEach(() => {
    rows.length = 0;
    writes.length = 0;
});

describe("how stale last-active may get", () => {
    it("is a number somebody chose, and one the screen can live with", () => {
        // Long enough to be worth skipping a write for, short enough that a
        // device list is not misleading about when you were last on it.
        expect(SESSION_TOUCH_INTERVAL_MS).toBeGreaterThanOrEqual(5 * 60_000);
        expect(SESSION_TOUCH_INTERVAL_MS).toBeLessThanOrEqual(60 * 60_000);
    });
});

describe("the statement itself", () => {
    it("leaves a row another worker has just refreshed alone", async () => {
        // Two processes share the database and not the token, so the second
        // one must not repeat the first one's write.
        await userSession.create({
            data: { tokenId: "t1", userId: "u1", expiresAt: new Date(NOW + 86_400_000) },
        });
        rows[0].lastActiveAt = new Date(NOW);

        await touchSession("t1", new Date(NOW + MINUTE));

        expect(writes[0].count).toBe(0);
        expect(rows[0].lastActiveAt.getTime()).toBe(NOW);
    });

    it("refreshes a row that has gone stale", async () => {
        await userSession.create({
            data: { tokenId: "t1", userId: "u1", expiresAt: new Date(NOW + 86_400_000) },
        });
        rows[0].lastActiveAt = new Date(NOW);

        const at = new Date(NOW + SESSION_TOUCH_INTERVAL_MS + MINUTE);
        await touchSession("t1", at);

        expect(writes[0].count).toBe(1);
        expect(rows[0].lastActiveAt.getTime()).toBe(at.getTime());
    });

    it("says nothing about a token with no row", async () => {
        await expect(touchSession("never-recorded")).resolves.toBeUndefined();
    });

    it("moves a renewing site's deadline on the same write, and only on it", async () => {
        // Renewal adds no write of its own: a row another worker just
        // refreshed keeps its deadline too, because the member was active
        // inside the interval and the deadline is at most that far behind.
        await userSession.create({
            data: { tokenId: "t1", userId: "u1", expiresAt: new Date(NOW + 86_400_000) },
        });
        rows[0].lastActiveAt = new Date(NOW);

        await touchSession("t1", new Date(NOW + MINUTE), new Date(NOW + 10 * 86_400_000));
        expect(rows[0].expiresAt.getTime()).toBe(NOW + 86_400_000);

        const at = new Date(NOW + SESSION_TOUCH_INTERVAL_MS + MINUTE);
        await touchSession("t1", at, new Date(at.getTime() + 86_400_000));
        expect(rows[0].expiresAt.getTime()).toBe(at.getTime() + 86_400_000);
        expect(writes).toHaveLength(2);
    });
});
