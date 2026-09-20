// @vitest-environment node
/**
 * A backup is kept somewhere that is not the machine it was taken on.
 *
 * Measured on 2026-09-20: every dump lived in `backups/` on the same disk as
 * the database, so the box that loses the database loses its backups too.
 *
 * Two shapes were ruled out before this one. Not the media storage provider:
 * `StorageProvider.upload` returns a public URL and R2's is a public base, so
 * a dump sent through it is the whole database downloadable by anyone who
 * guesses the key. And not the hook bus: `doActionAsync` races every listener
 * against a five second timeout, which an upload of a real dump cannot meet,
 * so a "backup created" listener would report a failure on every successful
 * backup.
 *
 * So the copy is a job of this module's own. It has no timeout to meet, a
 * dump it could not send is sent on the next tick without anybody retrying
 * anything, and what has already been sent is the bucket's own answer rather
 * than a list this module keeps and has to keep true.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const backups: { id: string; filename: string; sizeBytes: number; createdAt: Date; type: string }[] = [];
const bucket: string[] = [];
const sent: { key: string; bucket: string }[] = [];
let config: Record<string, unknown> | null = null;
let listFails = false;

vi.mock("@/core/sdk/server", () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    readSettingValues: async () => ({ cloudflare_r2_config: config }),
    listBackups: async () => backups,
    getBackupPath: async (id: string) => (backups.some((b) => b.id === id) ? `/backups/${id}.sql.gz` : null),
    sanitizeFilename: (name: string) => name,
}));

vi.mock("node:fs", () => ({
    default: {
        createReadStream: () => "a stream",
        statSync: () => ({ size: 1024 }),
    },
}));

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class {
        async send(command: { __kind: string; input: Record<string, unknown> }) {
            if (command.__kind === "list") {
                if (listFails) throw new Error("bucket unreachable");
                return { Contents: bucket.map((key) => ({ Key: key })) };
            }
            sent.push({ key: String(command.input.Key), bucket: String(command.input.Bucket) });
            return {};
        }
    },
    PutObjectCommand: class { __kind = "put"; constructor(public input: Record<string, unknown>) {} },
    ListObjectsV2Command: class { __kind = "list"; constructor(public input: Record<string, unknown>) {} },
}));

const configured = {
    accountId: "acc", bucket: "the-bucket", accessKey: "key", secretKey: "secret",
    publicUrl: "https://files.example.com", keepBackups: true, backupPrefix: "backups",
};

async function sweep() {
    const run = (await import("../../../module-sources/cloudflare-r2/cron/copy-backups")).default;
    await run();
}

beforeEach(() => {
    backups.length = 0;
    bucket.length = 0;
    sent.length = 0;
    listFails = false;
    config = { ...configured };
    vi.resetModules();
    backups.push(
        { id: "blysis-scheduled-a", filename: "blysis-scheduled-a.sql.gz", sizeBytes: 10, createdAt: new Date(), type: "scheduled" },
        { id: "blysis-manual-b", filename: "blysis-manual-b.sql.gz", sizeBytes: 10, createdAt: new Date(), type: "manual" },
    );
});

describe("what is copied", () => {
    it("is every backup the bucket does not already have", async () => {
        await sweep();
        expect(sent.map((s) => s.key).sort()).toEqual([
            "backups/blysis-manual-b.sql.gz",
            "backups/blysis-scheduled-a.sql.gz",
        ]);
        expect(sent.every((s) => s.bucket === "the-bucket")).toBe(true);
    });

    it("is nothing that is already there, so a nightly sweep sends one file", async () => {
        bucket.push("backups/blysis-scheduled-a.sql.gz");
        await sweep();
        expect(sent.map((s) => s.key)).toEqual(["backups/blysis-manual-b.sql.gz"]);
    });

    it("is nothing at all once the bucket has them", async () => {
        bucket.push("backups/blysis-scheduled-a.sql.gz", "backups/blysis-manual-b.sql.gz");
        await sweep();
        expect(sent).toEqual([]);
    });
});

describe("when nothing is copied", () => {
    it("is when the operator has not asked for it", async () => {
        config = { ...configured, keepBackups: false };
        await sweep();
        expect(sent).toEqual([]);
    });

    it("is when the bucket is not configured at all", async () => {
        config = null;
        await sweep();
        expect(sent).toEqual([]);
    });

    it("is when the bucket cannot be asked what it holds", async () => {
        // Sending everything again because the list failed would re-upload
        // the whole history on every tick.
        listFails = true;
        await sweep();
        expect(sent).toEqual([]);
    });
});

describe("where it lands", () => {
    it("is under the prefix the operator chose", async () => {
        config = { ...configured, backupPrefix: "site-a/dumps" };
        await sweep();
        expect(sent.map((s) => s.key).sort()).toEqual([
            "site-a/dumps/blysis-manual-b.sql.gz",
            "site-a/dumps/blysis-scheduled-a.sql.gz",
        ]);
    });

    it("is never at the root of a bucket that also holds public uploads", async () => {
        config = { ...configured, backupPrefix: "" };
        await sweep();
        expect(sent.every((s) => s.key.startsWith("backups/"))).toBe(true);
    });

    it("carries no public address back, because a dump is not a file to publish", async () => {
        const run = (await import("../../../module-sources/cloudflare-r2/cron/copy-backups")).default;
        await expect(run()).resolves.toBeUndefined();
    });
});
