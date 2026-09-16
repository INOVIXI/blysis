import { describe, it, expect, beforeEach, vi } from "vitest";
import { stripComments } from "./source-text";

const activityLogDeleteMany = vi.fn();
const activityFeedItemDeleteMany = vi.fn();
const cronRunDeleteMany = vi.fn();
const revisionDeleteMany = vi.fn();
const userSessionDeleteMany = vi.fn();
const verificationTokenDeleteMany = vi.fn();
const webhookLogDeleteMany = vi.fn();

vi.mock("@/core/lib/db", () => ({
    prisma: {
        activityLog: { deleteMany: (...a: unknown[]) => activityLogDeleteMany(...a) },
        activityFeedItem: { deleteMany: (...a: unknown[]) => activityFeedItemDeleteMany(...a) },
        cronRun: { deleteMany: (...a: unknown[]) => cronRunDeleteMany(...a) },
        revision: { deleteMany: (...a: unknown[]) => revisionDeleteMany(...a) },
        userSession: { deleteMany: (...a: unknown[]) => userSessionDeleteMany(...a) },
        verificationToken: { deleteMany: (...a: unknown[]) => verificationTokenDeleteMany(...a) },
        // Present, because the module that owns it is installed. Core still
        // must not touch it.
        webhookLog: { deleteMany: (...a: unknown[]) => webhookLogDeleteMany(...a) },
    },
}));

type RetentionModule = typeof import("@/core/lib/retention");
let mod: RetentionModule;

const DAY_MS = 24 * 60 * 60 * 1000;
const count = (n: number) => ({ count: n });

beforeEach(async () => {
    vi.resetModules();
    for (const fn of [
        activityLogDeleteMany,
        activityFeedItemDeleteMany,
        cronRunDeleteMany,
        revisionDeleteMany,
        userSessionDeleteMany,
        verificationTokenDeleteMany,
        webhookLogDeleteMany,
    ]) {
        fn.mockReset().mockResolvedValue(count(0));
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    mod = await import("@/core/lib/retention");
});

describe("retention: pruneOldRecords", () => {
    it("returns a count per table", async () => {
        activityFeedItemDeleteMany.mockResolvedValue(count(5));
        revisionDeleteMany.mockResolvedValue(count(3));
        verificationTokenDeleteMany.mockResolvedValue(count(4));

        expect(await mod.pruneOldRecords()).toEqual({
            activityLog: 0,
            activityFeed: 5,
            revision: 3,
            userSession: 0,
            verificationToken: 4,
        });
    });

    it("keeps activity feed items for 180 days", async () => {
        const before = Date.now();
        await mod.pruneOldRecords();
        const arg = activityFeedItemDeleteMany.mock.calls[0]?.[0] as { where: { createdAt: { lt: Date } } };
        expect(arg.where.createdAt.lt).toBeInstanceOf(Date);
        expect(Math.abs(arg.where.createdAt.lt.getTime() - (before - 180 * DAY_MS))).toBeLessThan(200);
    });

    it("keeps revisions for 365 days", async () => {
        const before = Date.now();
        await mod.pruneOldRecords();
        const rev = revisionDeleteMany.mock.calls[0]?.[0] as { where: { createdAt: { lt: Date } } };
        expect(Math.abs(rev.where.createdAt.lt.getTime() - (before - 365 * DAY_MS))).toBeLessThan(200);
    });

    it("one table failing does not stop the rest", async () => {
        activityFeedItemDeleteMany.mockRejectedValue(new Error("boom"));
        revisionDeleteMany.mockResolvedValue(count(4));
        verificationTokenDeleteMany.mockResolvedValue(count(1));

        const result = await mod.pruneOldRecords();
        expect(result.activityFeed).toBe(0);
        expect(result.revision).toBe(4);
        expect(result.verificationToken).toBe(1);
    });
});

/**
 * Email verification and password reset both write a VerificationToken, and
 * both leave the row behind whenever the person never finishes: an unconfirmed
 * signup, a reset link nobody clicked. Nothing consumes an expired one.
 *
 * The prune existed, in `runScheduledTasks()`, which no scheduled job ever
 * called - only `POST /api/v1/admin/cron`, and the admin panel does not use
 * that endpoint. So the rows had accumulated since the table existed.
 */
describe("expired verification tokens", () => {
    it("are pruned by the daily sweep", async () => {
        await mod.pruneOldRecords();
        expect(verificationTokenDeleteMany).toHaveBeenCalledTimes(1);
    });

    it("are pruned on expiry, with no grace window", async () => {
        const before = Date.now();
        await mod.pruneOldRecords();
        const after = Date.now();
        const arg = verificationTokenDeleteMany.mock.calls[0]?.[0] as { where: { expires: { lt: Date } } };
        const cutoff = arg.where.expires.lt.getTime();
        expect(cutoff).toBeGreaterThanOrEqual(before - 200);
        expect(cutoff).toBeLessThanOrEqual(after + 200);
    });

    it("do not take the sweep down when the table is missing", async () => {
        verificationTokenDeleteMany.mockRejectedValue(new Error("relation does not exist"));
        activityFeedItemDeleteMany.mockResolvedValue(count(9));

        const result = await mod.pruneOldRecords();
        expect(result.verificationToken).toBe(0);
        expect(result.activityFeed).toBe(9);
    });
});

/**
 * WebhookLog belongs to the `webhook-logs` module, which runs its own daily
 * cron over that table with the same thirty day window. Core used to prune it
 * as well, behind an `in prisma` guard - a module's work done twice a day, by
 * a core file naming a model it has no business knowing.
 */
describe("a module's table", () => {
    it("is left to the module", async () => {
        await mod.pruneOldRecords();
        expect(webhookLogDeleteMany).not.toHaveBeenCalled();
    });

    it("is not named in core's retention at all", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const source = fs.readFileSync(
            path.join(path.resolve(import.meta.dirname, "../.."), "src/core/lib/retention.ts"),
            "utf8",
        );
        const code = stripComments(source);
        expect(code).not.toContain("webhookLog");
    });
});

/**
 * The sweep was deleting live state, not history.
 *
 * The file opens by saying "Tables like ActivityFeedItem, CronRun and Revision
 * grow unbounded unless pruned", and for two of the three that is true. It is
 * not true of CronRun: `jobKey` is the primary key and `claimJob` upserts on
 * it, so the table holds exactly one row per registered job. Measured on this
 * install: thirteen rows, thirteen job keys, and no way for a fourteenth to
 * appear without a fourteenth job.
 *
 * What the prune actually reached was the row of a job that had not run for
 * thirty days, which is a job whose module is switched off, or one that runs
 * monthly. Deleting it takes `lastStatus` and `lastError` with it, and those
 * are what the observability screen reads to list what is broken: a job that
 * failed and then stopped running had its failure swept away by the daily
 * tidy-up.
 *
 * Nothing else in the sweep changes. The other four tables are append-only
 * and their windows stand.
 */
describe("the cron state table", () => {
    it("is left alone, because it is state rather than history", async () => {
        await mod.pruneOldRecords();
        expect(
            cronRunDeleteMany,
            "one row per job cannot grow unbounded, and deleting it erases the last failure",
        ).not.toHaveBeenCalled();
    });

    it("is not counted as something the sweep removed", async () => {
        const result = await mod.pruneOldRecords();
        expect(result).not.toHaveProperty("cronRun");
    });
});

/**
 * The admin audit trail is the table this file was written for and the one it
 * did not name. `logActivity` writes to it from sixty-two places - every admin
 * mutation the product makes - and nothing has ever deleted a row. Measured in
 * Postgres with its four indexes and the metadata blobs the call sites really
 * write: 451 bytes a row, so a site taking five hundred admin actions a day
 * keeps about 82 MB a year and never gives any of it back.
 *
 * The window is the one `Revision` already has, and for the reason already
 * written down there: this is audit data, so it is kept longer than a feed.
 */
describe("retention: the admin audit trail", () => {
    it("drops entries older than the audit window", async () => {
        activityLogDeleteMany.mockResolvedValue(count(9));
        const before = Date.now();

        const result = await mod.pruneOldRecords();

        expect(result.activityLog).toBe(9);
        const where = activityLogDeleteMany.mock.calls[0][0].where as {
            createdAt: { lt: Date };
        };
        const windowDays = (before - where.createdAt.lt.getTime()) / DAY_MS;
        expect(windowDays).toBeGreaterThan(364);
        expect(windowDays).toBeLessThan(366);
    });

    it("keeps the same window as the other audit table, so neither drifts", async () => {
        await mod.pruneOldRecords();

        const audit = (activityLogDeleteMany.mock.calls[0][0] as { where: { createdAt: { lt: Date } } })
            .where.createdAt.lt.getTime();
        const revision = (revisionDeleteMany.mock.calls[0][0] as { where: { createdAt: { lt: Date } } })
            .where.createdAt.lt.getTime();

        expect(Math.abs(audit - revision)).toBeLessThan(1000);
    });

    it("does not take the whole run down when its delete fails", async () => {
        activityLogDeleteMany.mockRejectedValue(new Error("deadlock detected"));
        revisionDeleteMany.mockResolvedValue(count(2));

        const result = await mod.pruneOldRecords();

        expect(result.activityLog).toBe(0);
        expect(result.revision).toBe(2);
    });
});
