/**
 * The schedules a job may name.
 *
 * The scheduler turns a name into an interval and refuses one it does not
 * recognise, so a name outside this list is a job that never runs. The module
 * manifest used to accept any string here and `validate-module` never looked
 * at the field, which meant an author who wrote "daily" or a five field cron
 * expression shipped a module that passed every gate with a scheduled job
 * that never fired, and one warning line at boot to say so.
 *
 * Kept in its own file, free of imports, so the manifest schema can name the
 * same list the scheduler runs on without pulling the scheduler, and its
 * database client, in behind it.
 */

export const CRON_SCHEDULES = [
    "every-minute",
    "every-5-minutes",
    "every-15-minutes",
    "every-hour",
    "every-day",
    "every-week",
    "every-month",
] as const;

export type CronSchedule = (typeof CRON_SCHEDULES)[number];

export const SCHEDULE_MS: Record<string, number> = {
    "every-minute": 60_000,
    "every-5-minutes": 5 * 60_000,
    "every-15-minutes": 15 * 60_000,
    "every-hour": 60 * 60_000,
    "every-day": 24 * 60 * 60_000,
    "every-week": 7 * 24 * 60 * 60_000,
    "every-month": 30 * 24 * 60 * 60_000,
};

/**
 * The outcomes the scheduler records, and what each of them is called.
 *
 * `lastStatus` is a column, and the jobs screen used to set it in a mono
 * uppercase badge - `OK`, `ERROR` - which is the database talking, not the
 * site. The same went for the cadence beside it: `every-5-minutes` is what a
 * manifest writes, not what an operator reads.
 *
 * Both sets are closed and both belong to core, so both are named here rather
 * than at the screen: `a-scheduled-job-says-how-it-went` compares the
 * statuses named below against the ones the scheduler writes, and a new
 * outcome that arrives without a word for it fails there instead of reaching
 * whoever is on call.
 *
 * This file stays free of imports so the manifest schema can read the
 * schedule list without pulling the scheduler and its database client in
 * behind it. Keys, not strings: the catalogue holds the words.
 */
/** `admin` namespace, one per cadence. */
export const SCHEDULE_NAME_KEY: Record<CronSchedule, string> = {
    "every-minute": "cron_everyMinute",
    "every-5-minutes": "cron_every5Minutes",
    "every-15-minutes": "cron_every15Minutes",
    "every-hour": "cron_everyHour",
    "every-day": "cron_everyDay",
    "every-week": "cron_everyWeek",
    "every-month": "cron_everyMonth",
};

/**
 * `admin` namespace, one per outcome. The outcomes are the keys of this map
 * rather than a list beside it: a second list would be a second thing to keep
 * true, and what the set has to agree with is the scheduler, not itself.
 */
export const STATUS_NAME_KEY = {
    "running": "cron_statusRunning",
    "ok": "cron_statusSucceeded",
    "error": "cron_statusFailed",
} as const;

export type CronStatus = keyof typeof STATUS_NAME_KEY;
