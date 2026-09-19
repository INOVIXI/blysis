// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CRON_SCHEDULES } from "@/core/lib/cron-schedules";

/**
 * The scheduled jobs screen says how often a job runs and how it went, in
 * words.
 *
 * It printed both straight out of the database. The cadence was the token the
 * manifest names - `every-5-minutes`, `every-15-minutes` - and the outcome
 * was the `lastStatus` column, set in a mono uppercase badge: `OK`, `ERROR`,
 * `RUNNING`. Every other status on the site wears a translated badge, and an
 * operator watching a site in Turkish had no reason to expect this one screen
 * to be the exception.
 *
 * Both are closed sets core owns, so both can be named once and named
 * completely. The check that keeps it true is the third one: the statuses the
 * screen has words for are compared against the ones the scheduler actually
 * writes, so adding a fourth outcome fails here rather than appearing raw on
 * the screen of whoever is on call.
 */

const ROOT = path.resolve(__dirname, "../..");
const SCREEN = path.join(ROOT, "src/app/[locale]/(admin)/admin/cron/page.tsx");
const SCHEDULER = path.join(ROOT, "src/core/lib/scheduler.ts");
const LABELS = path.join(ROOT, "src/core/lib/cron-schedules.ts");

function catalogue(locale: string): Record<string, string> {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8"));
    return json.admin as Record<string, string>;
}

/** The key each map in `cron-schedules` points a token at. */
function keysOf(mapName: string): Map<string, string> {
    const source = fs.readFileSync(LABELS, "utf8");
    const start = source.indexOf(`export const ${mapName}`);
    expect(start, `${mapName} is not declared`).toBeGreaterThan(-1);
    const body = source.slice(source.indexOf("{", start), source.indexOf("};", start));
    const out = new Map<string, string>();
    for (const row of body.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) out.set(row[1], row[2]);
    return out;
}

/** Every value the scheduler ever writes into `lastStatus`. */
function writtenStatuses(): Set<string> {
    const source = fs.readFileSync(SCHEDULER, "utf8");
    const found = new Set<string>();
    // `lastStatus` = 'running' in the claim, and the union the runner narrows
    // its own variable to before the update.
    for (const hit of source.matchAll(/"lastStatus"\s*=\s*'([a-z]+)'/g)) found.add(hit[1]);
    const union = /let status:\s*([^=]+)=/.exec(source);
    expect(union, "the runner no longer declares its status as a union").not.toBeNull();
    for (const hit of (union?.[1] ?? "").matchAll(/"([a-z]+)"/g)) found.add(hit[1]);
    return found;
}

describe("the scheduled jobs screen", () => {
    const screen = fs.readFileSync(SCREEN, "utf8");

    it("names every cadence a job may be given, in both languages", () => {
        const keys = keysOf("SCHEDULE_NAME_KEY");
        const missing: string[] = [];
        for (const schedule of CRON_SCHEDULES) {
            const key = keys.get(schedule);
            if (!key) {
                missing.push(`no key for ${schedule}`);
                continue;
            }
            for (const locale of ["en", "tr"]) {
                const value = catalogue(locale)[key];
                if (typeof value !== "string" || !value.trim()) missing.push(`${locale} admin.${key}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("names every outcome the scheduler records, in both languages", () => {
        const keys = keysOf("STATUS_NAME_KEY");
        const missing: string[] = [];
        for (const status of writtenStatuses()) {
            const key = keys.get(status);
            if (!key) {
                missing.push(`no key for ${status}`);
                continue;
            }
            for (const locale of ["en", "tr"]) {
                const value = catalogue(locale)[key];
                if (typeof value !== "string" || !value.trim()) missing.push(`${locale} admin.${key}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("knows exactly the outcomes the scheduler writes, no more and no fewer", () => {
        const written = writtenStatuses();
        expect(written.size).toBeGreaterThan(2);
        expect([...keysOf("STATUS_NAME_KEY").keys()].sort()).toEqual([...written].sort());
    });

    it("renders the words rather than the column", () => {
        expect(screen).not.toContain("{job.lastStatus}");
        expect(screen).not.toContain("{job.schedule}");
        expect(screen).toContain("STATUS_NAME_KEY");
        expect(screen).toContain("SCHEDULE_NAME_KEY");
    });
});
