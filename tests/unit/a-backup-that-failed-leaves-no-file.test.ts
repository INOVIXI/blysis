// @vitest-environment node
/**
 * A backup that failed leaves no file behind.
 *
 * `createBackup` pipes pg_dump through gzip into a file and, when anything
 * goes wrong, deletes that file. When pg_dump could not be started at all the
 * failure arrived before the file had been opened: the delete found nothing,
 * the stream opened the file a moment later and gzip closed it as an empty
 * archive. Twenty bytes, named like every other backup, listed on the backup
 * screen as one, and a restore from it restores nothing. The development box
 * had one from the first night it ran without the PostgreSQL client tools.
 *
 * Nothing is stubbed but where the backups go: the defect is an order of real
 * process and file events, which a stubbed spawn or `fs` does not have. PATH
 * points at an empty directory, so pg_dump cannot be found on any machine,
 * including one that has it installed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blysis-backup-failed-"));
const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), "blysis-no-tools-"));

vi.mock("@/core/lib/runtime-paths", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/core/lib/runtime-paths")>()),
    BACKUPS_DIR: dir,
}));
vi.mock("@/core/lib/db", () => ({ prisma: { setting: { findUnique: async () => null } } }));

const { createBackup } = await import("@/core/lib/backup");

beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://blysis:blysis@127.0.0.1:5432/blysis");
    vi.stubEnv("PATH", emptyPath);
    vi.stubEnv("Path", emptyPath);
    for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { force: true });
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("a backup that could not be taken", () => {
    it("says why", async () => {
        await expect(createBackup("scheduled")).rejects.toThrow(/pg_dump/);
    });

    it("leaves nothing on disk that the backup screen would list", async () => {
        await createBackup("scheduled").catch(() => undefined);
        // Long enough for a stream opened late to have written and closed.
        await new Promise((resolve) => setTimeout(resolve, 200));

        expect(fs.readdirSync(dir)).toEqual([]);
    });
});
