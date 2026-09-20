// @vitest-environment node
/**
 * How often the database is backed up, and how many are kept, is the
 * operator's answer.
 *
 * Measured on 2026-09-20: `core:automated-backup` was registered with the
 * literal `every-day`, retention was `RETAIN_SCHEDULED = 30` in the source,
 * and the only control on the screen was a tick box. A shop taking orders all
 * day had no way to ask for an hourly dump; a host with 20 GB free had no way
 * to keep fewer than thirty. The stored setting was `{ enabled }` and its own
 * comment said "Room for a schedule or a retention override later".
 *
 * The cadence is resolved on the tick rather than at registration, so an
 * operator who changes it does not have to restart the site for it to take.
 *
 * Two rules from the switch that came before carry over, because they are the
 * expensive ones. Silence means yes: an install that never chose is an
 * install that is being backed up, and a half-written or unreadable setting
 * reads as the default rather than as a night with no backup. And a cadence
 * nobody offered is refused at the door instead of stored, because the
 * scheduler turns a name it does not know into a job that never runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const settings = new Map<string, unknown>();

const setting = {
    findUnique: async ({ where }: { where: { key: string } }) =>
        (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
    upsert: async ({ where, create, update }: {
        where: { key: string };
        create: { key: string; value: unknown };
        update: { value: unknown };
    }) => {
        const value = settings.has(where.key) ? update.value : create.value;
        settings.set(where.key, value);
        return { key: where.key, value };
    },
};

vi.mock("@/core/lib/db", () => ({ prisma: { setting }, default: { prisma: { setting } } }));
vi.mock("@/core/lib/logger", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

let user: { id: string; role: string } | null = { id: "admin1", role: "admin" };
let admin = true;
vi.mock("@/core/lib/auth", () => ({ auth: async () => (user ? { user } : null) }));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async () => admin }));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: () => undefined }));
vi.mock("@/core/lib/backup", () => ({
    listBackups: async () => [],
    formatBytes: (n: number) => `${n} B`,
    createBackup: async () => ({ id: "b1", filename: "b1.sql.gz", sizeBytes: 10, createdAt: new Date(), type: "scheduled" }),
}));

const {
    AUTOMATED_BACKUP_SCHEDULES,
    DEFAULT_AUTOMATED_BACKUP,
    readAutomatedBackup,
    getAutomatedBackup,
    setAutomatedBackup,
    automatedBackupSchedule,
    scheduledBackupsToKeep,
} = await import("@/core/lib/backup-schedule");
const { GET, PATCH } = await import("@/app/api/v1/admin/backup/route");
const { NextRequest } = await import("next/server");

beforeEach(() => {
    settings.clear();
    user = { id: "admin1", role: "admin" };
    admin = true;
});

const patch = (body: unknown) =>
    PATCH(new NextRequest("http://example.com/api/v1/admin/backup", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    }));

describe("what an install that never chose is set to", () => {
    it("is backed up daily, keeping a month of them", () => {
        expect(DEFAULT_AUTOMATED_BACKUP).toEqual({ enabled: true, schedule: "every-day", keep: 30 });
    });

    it("reads that way from nothing at all", async () => {
        expect(await getAutomatedBackup()).toEqual(DEFAULT_AUTOMATED_BACKUP);
        expect(await automatedBackupSchedule()).toBe("every-day");
        expect(await scheduledBackupsToKeep()).toBe(30);
    });

    it("reads that way from a row that only ever held the switch", () => {
        // The shape before this existed. It is on every install today.
        expect(readAutomatedBackup({ enabled: false })).toEqual({
            enabled: false, schedule: "every-day", keep: 30,
        });
    });

    it("reads that way from a row somebody half wrote", () => {
        expect(readAutomatedBackup({ schedule: "fortnightly", keep: "lots" })).toEqual(DEFAULT_AUTOMATED_BACKUP);
        expect(readAutomatedBackup(null)).toEqual(DEFAULT_AUTOMATED_BACKUP);
        expect(readAutomatedBackup("every-hour")).toEqual(DEFAULT_AUTOMATED_BACKUP);
    });
});

describe("the cadence an operator chose", () => {
    it("is what the job is claimed on", async () => {
        await setAutomatedBackup({ schedule: "every-hour" });
        expect(await automatedBackupSchedule()).toBe("every-hour");
    });

    it("is one the scheduler knows, so a job cannot be registered that never runs", async () => {
        const { SCHEDULE_MS } = await import("@/core/lib/cron-schedules");
        for (const schedule of AUTOMATED_BACKUP_SCHEDULES) {
            expect(SCHEDULE_MS[schedule], schedule).toBeGreaterThan(0);
        }
    });

    it("is never one of the cadences that would dump the database every minute", () => {
        expect(AUTOMATED_BACKUP_SCHEDULES).not.toContain("every-minute");
        expect(AUTOMATED_BACKUP_SCHEDULES).not.toContain("every-5-minutes");
        expect(AUTOMATED_BACKUP_SCHEDULES).not.toContain("every-15-minutes");
    });
});

describe("how many are kept", () => {
    it("is the number the operator asked for", async () => {
        await setAutomatedBackup({ keep: 7 });
        expect(await scheduledBackupsToKeep()).toBe(7);
    });

    it("is never none, because that is a setting that deletes every backup", () => {
        expect(readAutomatedBackup({ keep: 0 }).keep).toBe(30);
        expect(readAutomatedBackup({ keep: -5 }).keep).toBe(30);
    });

    it("is bounded, because a disk is not", () => {
        expect(readAutomatedBackup({ keep: 100000 }).keep).toBe(365);
        expect(readAutomatedBackup({ keep: 3.7 }).keep).toBe(3);
    });
});

describe("the screen that sets it", () => {
    it("is told what is really stored", async () => {
        await setAutomatedBackup({ enabled: true, schedule: "every-week", keep: 4 });
        const body = await (await GET()).json();
        expect(body.automated).toEqual({ enabled: true, schedule: "every-week", keep: 4 });
    });

    it("offers the cadences that may be chosen, so the list is not written twice", async () => {
        const body = await (await GET()).json();
        expect(body.automated.schedules).toBeUndefined();
        expect(body.schedules).toEqual([...AUTOMATED_BACKUP_SCHEDULES]);
    });

    it("changes the cadence without touching the switch", async () => {
        await setAutomatedBackup({ enabled: false });
        expect((await patch({ schedule: "every-week" })).status).toBe(200);
        expect(await getAutomatedBackup()).toEqual({ enabled: false, schedule: "every-week", keep: 30 });
    });

    it("refuses a cadence nobody offered, and stores nothing", async () => {
        expect((await patch({ schedule: "every-minute" })).status).toBe(400);
        expect((await patch({ schedule: "fortnightly" })).status).toBe(400);
        expect(await automatedBackupSchedule()).toBe("every-day");
    });

    it("refuses a retention that is not a count, and stores nothing", async () => {
        expect((await patch({ keep: 0 })).status).toBe(400);
        expect((await patch({ keep: "ten" })).status).toBe(400);
        expect(await scheduledBackupsToKeep()).toBe(30);
    });

    it("still refuses a body that says nothing at all", async () => {
        expect((await patch({})).status).toBe(400);
    });

    it("is not something a member who is not an operator can change", async () => {
        admin = false;
        expect((await patch({ schedule: "every-hour" })).status).toBe(403);
        expect(await automatedBackupSchedule()).toBe("every-day");
    });
});
