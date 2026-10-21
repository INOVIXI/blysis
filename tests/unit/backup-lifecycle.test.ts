import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough, Readable, Writable } from "stream";
import zlib from "zlib";
import { basename } from "path";

/**
 * `tests/unit/backup.test.ts` covers the pure helpers and the id guards.
 * This file covers what actually spawns processes: taking a dump, restoring
 * one, and rotating the rest away.
 *
 * Restore is the most destructive operation the platform has - pg_dump's
 * `--clean --if-exists` header drops every table before it reloads them -
 * and it runs during an incident, when nobody is in a position to debug it.
 * Rotation is destructive too, just quietly: deleting the wrong side of the
 * retention window throws away the backups an operator is about to need.
 *
 * Real streams are used throughout so `pipeline` and `.pipe()` behave as
 * they do in production; only the process spawn and the filesystem are
 * stubbed.
 */

interface SpawnCall { command: string; args: string[]; options: { env?: NodeJS.ProcessEnv } }

const spawnCalls: SpawnCall[] = [];

class FakeChild extends EventEmitter {
    stdout = Readable.from([]);
    stderr = new PassThrough();
    stdin = new PassThrough();
    killed = false;
    kill() { this.killed = true; return true; }
}

let nextChild: (child: FakeChild) => void;

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("child_process", () => ({ spawn, default: { spawn } }));

// --- filesystem ----------------------------------------------------------

let writtenChunks: Buffer[];
let readStreamContent: string | Buffer | Error;
let dirEntries: string[];
let statResults: Record<string, { size: number; mtime: Date; isFile: boolean }>;
let unlinked: string[];
let accessThrows: boolean;
let notesWritten: Record<string, string>;

const { fsMock, fspMock } = vi.hoisted(() => {
    const fsMock = {
        createWriteStream: vi.fn(),
        createReadStream: vi.fn(),
    };
    const fspMock = {
        mkdir: vi.fn(),
        stat: vi.fn(),
        readdir: vi.fn(),
        unlink: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        access: vi.fn(),
    };
    return { fsMock, fspMock };
});

vi.mock("fs", () => ({ default: fsMock, ...fsMock }));
vi.mock("fs/promises", () => ({ default: fspMock, ...fspMock }));

// Retention asks the automated-backup setting how many scheduled archives to
// keep. Without this the real client went looking for the database in the
// stubbed DATABASE_URL on every rotation, and the answer only came out right
// because the failure falls back to the same defaults an unset row does.
vi.mock("@/core/lib/db", () => ({
    prisma: { setting: { findUnique: async () => null } },
}));

type Backup = typeof import("@/core/lib/backup");

async function load(): Promise<Backup> {
    vi.resetModules();
    return import("@/core/lib/backup");
}

beforeEach(() => {
    spawnCalls.length = 0;
    spawn.mockReset();
    writtenChunks = [];
    readStreamContent = zlib.gzipSync("-- SQL dump\n");
    dirEntries = [];
    statResults = {};
    unlinked = [];
    accessThrows = false;
    notesWritten = {};
    nextChild = (child) => { setImmediate(() => child.emit("exit", 0)); };

    vi.stubEnv("DATABASE_URL", "postgresql://user:s3cr3t@db.internal:5433/blysis");

    spawn.mockImplementation(((command: string, args: string[], options: SpawnCall["options"]) => {
        spawnCalls.push({ command, args, options });
        const child = new FakeChild();
        nextChild(child);
        return child;
    }) as never);

    fsMock.createWriteStream.mockImplementation((() => new Writable({
        write(chunk, _enc, cb) { writtenChunks.push(Buffer.from(chunk)); cb(); },
    })) as never);

    fsMock.createReadStream.mockImplementation((() => {
        if (readStreamContent instanceof Error) {
            const s = new Readable({ read() { } });
            const err = readStreamContent;
            setImmediate(() => s.emit("error", err));
            return s;
        }
        return Readable.from([readStreamContent]);
    }) as never);

    fspMock.mkdir.mockResolvedValue(undefined);
    fspMock.readdir.mockImplementation(async () => dirEntries);
    fspMock.stat.mockImplementation(async (p: string) => {
        const name = basename(String(p));
        const s = statResults[name] ?? { size: 1024, mtime: new Date("2026-09-01T00:00:00Z"), isFile: true };
        return {
            size: s.size,
            mtime: s.mtime,
            birthtime: s.mtime,
            isFile: () => s.isFile,
        };
    });
    fspMock.unlink.mockImplementation(async (p: string) => { unlinked.push(basename(String(p))); });
    fspMock.readFile.mockRejectedValue(new Error("ENOENT"));
    fspMock.writeFile.mockImplementation(async (p: string, data: string) => {
        notesWritten[basename(String(p))] = data;
    });
    fspMock.access.mockImplementation(async () => {
        if (accessThrows) throw new Error("ENOENT");
    });
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

function backupName(type: "manual" | "scheduled", iso: string): string {
    return `blysis-${type}-${iso.replace(/[:.]/g, "-")}.sql.gz`;
}

describe("createBackup", () => {
    it("dumps with the flags that make the archive restorable anywhere", async () => {
        const { createBackup } = await load();
        await createBackup("manual");

        expect(spawnCalls[0].command).toBe("pg_dump");
        // --no-owner/--no-acl so the dump loads under a different role;
        // --clean --if-exists so a restore replaces rather than collides.
        expect(spawnCalls[0].args).toEqual(["--no-owner", "--no-acl", "--clean", "--if-exists"]);
    });

    it("passes the connection as PG* vars and keeps DATABASE_URL out of the child", async () => {
        const { createBackup } = await load();
        await createBackup("manual");

        const env = spawnCalls[0].options.env!;
        expect(env.PGHOST).toBe("db.internal");
        expect(env.PGPORT).toBe("5433");
        expect(env.PGDATABASE).toBe("blysis");
        expect(env.PGUSER).toBe("user");
        expect(env.PGPASSWORD).toBe("s3cr3t");
        // A child process that inherits DATABASE_URL can print it in an error
        // or a crash dump, password and all.
        expect(env.DATABASE_URL).toBeUndefined();
    });

    it("defaults the port and url-decodes credentials", async () => {
        vi.stubEnv("DATABASE_URL", "postgresql://a%40b:p%40ss%2Fword@localhost/db");
        const { createBackup } = await load();
        await createBackup("manual");

        const env = spawnCalls[0].options.env!;
        expect(env.PGPORT).toBe("5432");
        // A password with a slash or an @ is common and must survive the URL.
        expect(env.PGUSER).toBe("a@b");
        expect(env.PGPASSWORD).toBe("p@ss/word");
    });

    it("refuses to run without a DATABASE_URL", async () => {
        vi.stubEnv("DATABASE_URL", undefined);
        const { createBackup } = await load();

        await expect(createBackup("manual")).rejects.toThrow("DATABASE_URL not configured");
        expect(spawn).not.toHaveBeenCalled();
    });

    it("writes a gzipped archive named for its type and timestamp", async () => {
        nextChild = (child) => {
            child.stdout = Readable.from(["-- SQL dump\n"]);
            setImmediate(() => child.emit("exit", 0));
        };
        const { createBackup } = await load();

        const meta = await createBackup("scheduled");

        expect(meta.filename).toMatch(/^blysis-scheduled-[0-9TZ-]+\.sql\.gz$/);
        expect(meta.id).toBe(meta.filename.replace(".sql.gz", ""));
        expect(meta.type).toBe("scheduled");
        // gzip magic number - the file on disk is actually compressed.
        const written = Buffer.concat(writtenChunks);
        expect(written[0]).toBe(0x1f);
        expect(written[1]).toBe(0x8b);
    });

    it("deletes the partial file when pg_dump fails", async () => {
        nextChild = (child) => {
            child.stdout = Readable.from(["partial"]);
            setImmediate(() => {
                child.stderr.write("could not connect to server");
                child.emit("exit", 1);
            });
        };
        const { createBackup } = await load();

        await expect(createBackup("manual")).rejects.toThrow(/pg_dump exited with code 1/);
        // A truncated archive that looks like a backup is worse than none:
        // it is the one an operator reaches for and it will not restore.
        expect(unlinked).toHaveLength(1);
        expect(unlinked[0]).toMatch(/^blysis-manual-.*\.sql\.gz$/);
    });

    it("reports pg_dump's own stderr in the error", async () => {
        nextChild = (child) => {
            child.stdout = Readable.from([""]);
            setImmediate(() => {
                child.stderr.write("FATAL: password authentication failed");
                child.emit("exit", 1);
            });
        };
        const { createBackup } = await load();

        await expect(createBackup("manual"))
            .rejects.toThrow(/password authentication failed/);
    });

    it("cleans up when pg_dump cannot be spawned at all", async () => {
        nextChild = (child) => {
            child.stdout = Readable.from([""]);
            setImmediate(() => child.emit("error", new Error("spawn pg_dump ENOENT")));
        };
        const { createBackup } = await load();

        await expect(createBackup("manual")).rejects.toThrow("spawn pg_dump ENOENT");
        expect(unlinked).toHaveLength(1);
    });

    // The server's own CronRun row for `core:automated-backup` read
    // "spawn pg_dump ENOENT" for a day. That names a syscall, not a problem an
    // operator can act on, and the runtime image shipped without the
    // PostgreSQL client tools at all - so this is the message a real
    // deployment sees first.
    it("says which tool is missing when pg_dump is not installed", async () => {
        nextChild = (child) => {
            child.stdout = Readable.from([""]);
            setImmediate(() => {
                const err: NodeJS.ErrnoException = new Error("spawn pg_dump ENOENT");
                err.code = "ENOENT";
                child.emit("error", err);
            });
        };
        const { createBackup } = await load();

        await expect(createBackup("manual")).rejects.toThrow(
            /pg_dump.*PostgreSQL client tools/,
        );
    });

    it("still removes the half-written archive when the tool is missing", async () => {
        nextChild = (child) => {
            child.stdout = Readable.from([""]);
            setImmediate(() => {
                const err: NodeJS.ErrnoException = new Error("spawn pg_dump ENOENT");
                err.code = "ENOENT";
                child.emit("error", err);
            });
        };
        const { createBackup } = await load();

        await expect(createBackup("manual")).rejects.toThrow();
        expect(unlinked).toHaveLength(1);
    });

    it("stores a trimmed note beside the archive", async () => {
        const { createBackup } = await load();
        const meta = await createBackup("manual", "  pre-install:blog  ");

        expect(meta.notes).toBe("pre-install:blog");
        expect(notesWritten[`${meta.filename}.note`]).toBe("pre-install:blog");
    });

    it("writes no note file for blank notes", async () => {
        const { createBackup } = await load();
        const meta = await createBackup("manual", "   ");

        expect(meta.notes).toBeUndefined();
        expect(Object.keys(notesWritten)).toHaveLength(0);
    });

    it("still returns the archive when rotation fails", async () => {
        fspMock.readdir.mockRejectedValue(new Error("EACCES"));
        const { createBackup } = await load();

        // The dump succeeded; a housekeeping failure must not report it as
        // lost and send the operator looking for a file that exists.
        await expect(createBackup("manual")).resolves.toMatchObject({ type: "manual" });
    });
});

describe("retention", () => {
    /** `count` backups one day apart, oldest first, registered with stat. */
    function seed(type: "manual" | "scheduled", count: number, startMs: number): string[] {
        const names: string[] = [];
        for (let i = 0; i < count; i += 1) {
            const at = new Date(startMs + i * 86_400_000);
            const name = backupName(type, at.toISOString());
            statResults[name] = { size: 10, mtime: at, isFile: true };
            names.push(name);
        }
        return names;
    }

    it("keeps the newest 10 manual and 30 scheduled, deleting only the rest", async () => {
        const manual = seed("manual", 12, Date.parse("2026-01-01T00:00:00.000Z"));
        const scheduled = seed("scheduled", 33, Date.parse("2026-03-01T00:00:00.000Z"));
        dirEntries = [...manual, ...scheduled];

        const { createBackup } = await load();
        await createBackup("manual");

        const deletedArchives = unlinked.filter((f) => f.endsWith(".sql.gz"));
        // 12 manual, keep 10 -> 2 go; 33 scheduled, keep 30 -> 3 go. Each
        // retention class is counted on its own, so a burst of scheduled
        // dumps can never push out a manual one an operator took on purpose.
        expect(deletedArchives).toHaveLength(5);
        // The survivors must be the newest, never the oldest.
        expect(deletedArchives).toContain(manual[0]);
        expect(deletedArchives).toContain(manual[1]);
        expect(deletedArchives).not.toContain(manual[11]);
        expect(deletedArchives).toContain(scheduled[0]);
        expect(deletedArchives).not.toContain(scheduled[32]);
    });

    it("deletes nothing while under the retention limits", async () => {
        dirEntries = [backupName("manual", "2026-09-01T00:00:00.000Z")];
        const { createBackup } = await load();
        await createBackup("manual");

        expect(unlinked.filter((f) => f.endsWith(".sql.gz"))).toHaveLength(0);
    });
});

describe("restoreBackup", () => {
    const VALID_ID = "blysis-manual-2026-09-01T00-00-00-000Z";

    it("reloads the archive through psql with ON_ERROR_STOP", async () => {
        const { restoreBackup } = await load();

        expect(await restoreBackup(VALID_ID)).toEqual({ success: true });
        expect(spawnCalls[0].command).toBe("psql");
        // Without ON_ERROR_STOP psql reports success after skipping every
        // statement that failed, leaving a half-restored database.
        expect(spawnCalls[0].args).toEqual(["--quiet", "--set=ON_ERROR_STOP=1"]);
    });

    it("keeps DATABASE_URL out of the psql child too", async () => {
        const { restoreBackup } = await load();
        await restoreBackup(VALID_ID);

        expect(spawnCalls[0].options.env!.DATABASE_URL).toBeUndefined();
        expect(spawnCalls[0].options.env!.PGPASSWORD).toBe("s3cr3t");
    });

    it("says which tool is missing when psql is not installed", async () => {
        nextChild = (child) => {
            setImmediate(() => {
                const err: NodeJS.ErrnoException = new Error("spawn psql ENOENT");
                err.code = "ENOENT";
                child.emit("error", err);
            });
        };
        const { restoreBackup } = await load();

        const result = await restoreBackup(VALID_ID);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/psql.*PostgreSQL client tools/);
    });

    it.each([
        "../../etc/passwd",
        "blysis-manual-2026-09-01T00-00-00-000Z/../../../etc/passwd",
        "not-a-backup",
        "blysis-hacked-2026-09-01T00-00-00-000Z",
        "",
    ])("refuses the id %o without spawning psql", async (id) => {
        const { restoreBackup } = await load();

        expect(await restoreBackup(id)).toEqual({ success: false, error: "Invalid backup id" });
        // The id comes off an HTTP route; it must be rejected before it can
        // choose which file gets piped into a database superuser session.
        expect(spawn).not.toHaveBeenCalled();
    });

    it("reports a missing archive without spawning psql", async () => {
        accessThrows = true;
        const { restoreBackup } = await load();

        expect(await restoreBackup(VALID_ID)).toEqual({ success: false, error: "Backup not found" });
        expect(spawn).not.toHaveBeenCalled();
    });

    it("reports a missing DATABASE_URL without spawning psql", async () => {
        vi.stubEnv("DATABASE_URL", undefined);
        const { restoreBackup } = await load();

        expect(await restoreBackup(VALID_ID)).toEqual({
            success: false,
            error: "DATABASE_URL not configured",
        });
        expect(spawn).not.toHaveBeenCalled();
    });

    it("returns psql's exit code and stderr rather than throwing", async () => {
        nextChild = (child) => {
            setImmediate(() => {
                child.stderr.write("ERROR: relation \"User\" already exists");
                child.emit("exit", 3);
            });
        };
        const { restoreBackup } = await load();

        const result = await restoreBackup(VALID_ID);
        expect(result.success).toBe(false);
        expect(result.error).toContain("psql exited with code 3");
        expect(result.error).toContain('relation "User" already exists');
    });

    it("truncates a very long psql error", async () => {
        nextChild = (child) => {
            setImmediate(() => {
                child.stderr.write("x".repeat(2000));
                child.emit("exit", 1);
            });
        };
        const { restoreBackup } = await load();

        const result = await restoreBackup(VALID_ID);
        // The message reaches an admin UI toast; 2 KB of psql noise there
        // hides the part that matters.
        expect(result.error!.length).toBeLessThan(600);
    });

    it("reports a psql that cannot be spawned", async () => {
        nextChild = (child) => {
            setImmediate(() => child.emit("error", new Error("spawn psql ENOENT")));
        };
        const { restoreBackup } = await load();

        expect(await restoreBackup(VALID_ID)).toEqual({
            success: false,
            error: "spawn psql ENOENT",
        });
    });

    it("kills psql when the archive cannot be read", async () => {
        readStreamContent = new Error("EIO: i/o error");
        let child: FakeChild | null = null;
        nextChild = (c) => { child = c; };
        const { restoreBackup } = await load();

        expect(await restoreBackup(VALID_ID)).toEqual({ success: false, error: "EIO: i/o error" });
        // Leaving psql attached to a half-sent dump would keep applying it.
        expect((child as unknown as FakeChild).killed).toBe(true);
    });

    it("kills psql when the archive is not valid gzip", async () => {
        readStreamContent = "this is not gzip data";
        let child: FakeChild | null = null;
        nextChild = (c) => { child = c; };
        const { restoreBackup } = await load();

        const result = await restoreBackup(VALID_ID);
        expect(result.success).toBe(false);
        expect((child as unknown as FakeChild).killed).toBe(true);
    });
});
