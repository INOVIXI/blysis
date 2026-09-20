/**
 * When the database is backed up, how many are kept, and the job that honours
 * both.
 *
 * `createBackup` shells out to `pg_dump`. That binary is in the runtime image
 * and is not on every host this runs on, and plenty of operators back the
 * database up from outside the application anyway. Until the switch existed
 * the job was registered unconditionally, so those installs had one state
 * available to them: an error every night, for ever, recorded where only the
 * observability screen looks.
 *
 * The cadence and the retention were written into the source beside it -
 * `every-day` at the registration and `RETAIN_SCHEDULED = 30` in `backup.ts`.
 * A shop taking orders all day could not ask for an hourly dump and a host
 * with 20 GB free could not keep fewer. Both are the operator's answer now,
 * and the cadence is resolved on the tick rather than at registration, so
 * changing it does not need a restart.
 *
 * Three things this deliberately does not do. It does not swallow a failure
 * of an enabled backup - that bug has been fixed once already, and a green
 * tick over an empty `backups/` directory is worse than a red one. It does
 * not read a missing or half-written setting as "off" or as "keep none":
 * every install that exists today has this job running, so silence has to
 * keep meaning yes, and a typo must not be the thing that deletes every
 * backup. And it never hands the scheduler a cadence the scheduler does not
 * know, because an unknown name is a job that never runs and says nothing.
 */
import { CRON_SCHEDULES, type CronSchedule } from "./cron-schedules";
import { prisma } from "./db";
import { errorText, log } from "./logger";

const AUTOMATED_BACKUP_SETTING_KEY = "automated_backup";

/**
 * The cadences a backup may be put on.
 *
 * A subset of the scheduler's vocabulary, because the rest of it is measured
 * in minutes: a `pg_dump` every five minutes is not a backup policy, it is an
 * outage. Hourly is the floor a busy shop actually wants.
 */
export const AUTOMATED_BACKUP_SCHEDULES = [
    "every-hour",
    "every-day",
    "every-week",
    "every-month",
] as const satisfies readonly CronSchedule[];

export type AutomatedBackupSchedule = (typeof AUTOMATED_BACKUP_SCHEDULES)[number];

/** Keeping none is not a retention policy, and a disk is not unbounded. */
const MIN_KEEP = 1;
const MAX_KEEP = 365;

export interface AutomatedBackup {
    enabled: boolean;
    schedule: AutomatedBackupSchedule;
    /** How many scheduled backups to keep. Manual ones are kept separately. */
    keep: number;
}

export const DEFAULT_AUTOMATED_BACKUP: AutomatedBackup = {
    enabled: true,
    schedule: "every-day",
    keep: 30,
};

/**
 * The stored row as an answer, whatever is in it.
 *
 * Pure, because every rule here is about a value that arrived broken and the
 * cheapest place to be sure of them is a test that does not need a database.
 * The row on disk is a `{ enabled }` object on every install that predates
 * the other two fields, so each field falls back on its own.
 */
export function readAutomatedBackup(raw: unknown): AutomatedBackup {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_AUTOMATED_BACKUP };
    const stored = raw as Record<string, unknown>;

    // Only an explicit false switches it off, so a half-written row reads as
    // the default rather than as a night without a backup.
    const enabled = stored.enabled !== false;

    const named = AUTOMATED_BACKUP_SCHEDULES.find((one) => one === stored.schedule);

    const asked = typeof stored.keep === "number" && Number.isFinite(stored.keep)
        ? Math.floor(stored.keep)
        : null;
    const keep = asked === null || asked < MIN_KEEP
        ? DEFAULT_AUTOMATED_BACKUP.keep
        : Math.min(asked, MAX_KEEP);

    return { enabled, schedule: named ?? DEFAULT_AUTOMATED_BACKUP.schedule, keep };
}

export async function getAutomatedBackup(): Promise<AutomatedBackup> {
    try {
        const row = await prisma.setting.findUnique({ where: { key: AUTOMATED_BACKUP_SETTING_KEY } });
        return readAutomatedBackup(row?.value ?? null);
    } catch (err) {
        log.warn("[backup] could not read the automated backup setting", { error: errorText(err) });
        return { ...DEFAULT_AUTOMATED_BACKUP };
    }
}

/** Writes the fields given and leaves the rest as they stand. */
export async function setAutomatedBackup(patch: Partial<AutomatedBackup>): Promise<AutomatedBackup> {
    const current = await getAutomatedBackup();
    const next = readAutomatedBackup({ ...current, ...patch });
    const value = next as unknown as object;
    await prisma.setting.upsert({
        where: { key: AUTOMATED_BACKUP_SETTING_KEY },
        update: { value },
        create: { key: AUTOMATED_BACKUP_SETTING_KEY, value, module: "core" },
    });
    return next;
}

export async function isAutomatedBackupEnabled(): Promise<boolean> {
    return (await getAutomatedBackup()).enabled;
}

export async function setAutomatedBackupEnabled(enabled: boolean): Promise<void> {
    await setAutomatedBackup({ enabled });
}

/**
 * The cadence the scheduler claims the job on, read fresh every tick.
 *
 * Never a name outside the scheduler's own list: `claimJob` turns an unknown
 * one into a job that quietly never runs, which is the failure this whole
 * file exists to avoid.
 */
export async function automatedBackupSchedule(): Promise<CronSchedule> {
    const { schedule } = await getAutomatedBackup();
    return CRON_SCHEDULES.includes(schedule) ? schedule : DEFAULT_AUTOMATED_BACKUP.schedule;
}

/** How many scheduled backups rotation keeps. */
export async function scheduledBackupsToKeep(): Promise<number> {
    return (await getAutomatedBackup()).keep;
}

/**
 * The job. Throws when an enabled backup fails, which is how the failure
 * reaches this job's `CronRun` row and the observability screen.
 */
export async function runScheduledBackup(): Promise<void> {
    if (!(await isAutomatedBackupEnabled())) {
        log.info("cron: automated backup is switched off", { job: "automated-backup" });
        return;
    }
    const { createBackup } = await import("./backup");
    const meta = await createBackup("scheduled", "Automated backup");
    log.info("cron: automated backup created", {
        job: "automated-backup",
        filename: meta.filename,
        sizeBytes: meta.sizeBytes,
    });
}
