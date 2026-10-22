// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolCommand } from "@/core/lib/tool-command";

/**
 * A backup taken from the terminal is one the panel lists and can restore.
 *
 * `npm run db:backup` was a bash script with its own copy of what
 * `src/core/lib/backup.ts` does. It named its dumps `blysis_<date>.sql.gz`,
 * which the panel's backup screen does not recognise, so a dump taken before
 * something frightening never appeared where an admin would look for it. It
 * dumped without `--clean --if-exists`, so restoring one over a live schema
 * errored on every table that already existed and carried on, leaving a mix
 * of the backup and what was there before. It kept its own ten regardless of the
 * retention the operator had set, and it needed bash, so it did not start on
 * Windows at all.
 *
 * Both commands now go through the library the panel uses. These run them in
 * a scratch directory with no database, so they show what each refuses before
 * anything reaches PostgreSQL.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
let workDir = "";

function run(script: string, args: string[], input = ""): { status: number | null; out: string } {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const result = spawnSync(...toolCommand(["npx", "tsx", path.join(ROOT, script), ...args], ROOT), {
        cwd: workDir,
        env,
        input,
        encoding: "utf8",
        timeout: 60000,
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function backupFile(name: string): string {
    const dir = path.join(workDir, "backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, "");
    return file;
}

beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-cli-"));
});

afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

describe("npm run db:backup", () => {
    it("is the library the panel uses, not a script of its own", () => {
        const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
        expect(scripts["db:backup"]).toBe("npx tsx scripts/backup.ts");
        expect(scripts["db:restore"]).toBe("npx tsx scripts/restore.ts");
        expect(fs.readFileSync(path.join(ROOT, "scripts/backup.ts"), "utf8")).toContain("../src/core/lib/backup");
    });

    it("says what is missing and leaves no file behind when there is no database to dump", () => {
        const { status, out } = run("scripts/backup.ts", []);
        expect(status).toBe(1);
        expect(out).toContain("DATABASE_URL");
        const dir = path.join(workDir, "backups");
        expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
    });
});

describe("npm run db:restore", () => {
    it("lists the backups the panel would list when it is not told which", () => {
        backupFile("blysis-manual-2026-10-22T09-00-00-000Z.sql.gz");
        backupFile("notes.txt");
        const { status, out } = run("scripts/restore.ts", []);
        expect(status).toBe(1);
        expect(out).toContain("blysis-manual-2026-10-22T09-00-00-000Z");
        expect(out).not.toContain("notes.txt");
    });

    it("refuses a file that is not a backup in backups/", () => {
        const stray = path.join(workDir, "elsewhere.sql.gz");
        fs.writeFileSync(stray, "");
        const { status, out } = run("scripts/restore.ts", [stray]);
        expect(status).toBe(1);
        expect(out).toMatch(/not a backup/i);
    });

    it("asks before overwriting, and stops at anything but the word restore", () => {
        const file = backupFile("blysis-scheduled-2026-10-22T09-00-00-000Z.sql.gz");
        const { status, out } = run("scripts/restore.ts", [file], "y\n");
        expect(status).toBe(0);
        expect(out).toMatch(/overwrites/i);
        expect(out).toMatch(/cancelled/i);
        // Past the question it would have needed a database and said so.
        expect(out).not.toContain("DATABASE_URL");
    });

    it("takes the id the panel shows as well as the file name", () => {
        backupFile("blysis-manual-2026-10-22T09-00-00-000Z.sql.gz");
        const { status, out } = run("scripts/restore.ts", ["blysis-manual-2026-10-22T09-00-00-000Z"], "restore\n");
        expect(status).toBe(1);
        expect(out).toContain("DATABASE_URL");
    });
});
