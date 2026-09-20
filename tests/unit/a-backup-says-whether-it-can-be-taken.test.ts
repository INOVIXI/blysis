// @vitest-environment node
/**
 * The backup screen says whether a backup can be taken here, before one is.
 *
 * `createBackup` shells out to `pg_dump`. Measured on this box on 2026-09-19:
 * Postgres runs in a container and the client tools are not on the host, so
 * `core:automated-backup` has recorded "pg_dump was not found on the server"
 * every night since. The message is right and it arrives in the wrong place -
 * a red row on the scheduled jobs screen, a day after the operator set the
 * thing up, or a failed attempt at the moment they needed a backup most.
 *
 * The shipped image is fine: its Dockerfile installs `postgresql18-client`
 * and says why. What has no answer is every other shape - a native install, a
 * minimal image somebody built themselves, a host whose client is older than
 * the server it is pointed at.
 *
 * That last one is the quiet case. `pg_dump` refuses a server newer than
 * itself and takes an older one happily, so a client 16 against a server 18 is
 * a backup that has never worked and an error nobody reads until they try to
 * restore.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let dumpVersion: string | null = "pg_dump (PostgreSQL) 18.1";
let spawnError: NodeJS.ErrnoException | null = null;
let serverVersion: number | null = 180001;
let serverThrows = false;

vi.mock("child_process", () => ({
    spawn: () => {
        const listeners: Record<string, ((arg?: unknown) => void)[]> = {};
        const on = (event: string, fn: (arg?: unknown) => void) => {
            (listeners[event] ??= []).push(fn);
            return { on };
        };
        const emit = (event: string, arg?: unknown) => (listeners[event] ?? []).forEach((fn) => fn(arg));
        queueMicrotask(() => {
            if (spawnError) { emit("error", spawnError); return; }
            if (dumpVersion !== null) (listeners.__stdout ?? []).forEach((fn) => fn(Buffer.from(dumpVersion!)));
            emit("exit", 0);
        });
        return {
            on,
            stdout: { on: (_e: string, fn: (b: Buffer) => void) => { (listeners.__stdout ??= []).push(fn as never); } },
            stderr: { on: () => {} },
        };
    },
}));

vi.mock("@/core/lib/db", () => ({
    prisma: {
        $queryRawUnsafe: async () => {
            if (serverThrows) throw new Error("connection refused");
            return [{ v: serverVersion }];
        },
    },
}));
vi.mock("@/core/lib/logger", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    errorText: (e: unknown) => String(e),
}));

const { canTakeABackup, resetBackupToolCheck } = await import("@/core/lib/backup-tools");

beforeEach(() => {
    dumpVersion = "pg_dump (PostgreSQL) 18.1";
    spawnError = null;
    serverVersion = 180001;
    serverThrows = false;
    resetBackupToolCheck();
});

describe("a server with the tools", () => {
    it("can take one, and says which client it found", async () => {
        const answer = await canTakeABackup();
        expect(answer).toMatchObject({ ok: true, reason: null, clientMajor: 18, serverMajor: 18 });
    });

    it("can take one with a client newer than the server, which is the usual shape", async () => {
        dumpVersion = "pg_dump (PostgreSQL) 18.1";
        serverVersion = 170004;
        expect((await canTakeABackup()).ok).toBe(true);
    });
});

describe("a server without them", () => {
    it("says so, and says what to install", async () => {
        spawnError = Object.assign(new Error("spawn pg_dump ENOENT"), { code: "ENOENT" });
        const answer = await canTakeABackup();
        expect(answer.ok).toBe(false);
        expect(answer.reason).toBe("missing");
    });
});

describe("a client older than the server", () => {
    it("says so before the nightly job finds out", async () => {
        // pg_dump refuses a server newer than itself, so this has never
        // worked - it just has not been tried yet.
        dumpVersion = "pg_dump (PostgreSQL) 16.4";
        serverVersion = 180001;
        const answer = await canTakeABackup();
        expect(answer).toMatchObject({ ok: false, reason: "too_old", clientMajor: 16, serverMajor: 18 });
    });
});

describe("a check that cannot finish", () => {
    it("does not claim a backup is impossible when it is the database that would not answer", async () => {
        // A database that will not say its version is a database problem. The
        // backup may well work; refusing to offer one would be this check
        // taking the screen down with it.
        serverThrows = true;
        expect((await canTakeABackup()).ok).toBe(true);
    });

    it("reads a version string it does not recognise as no answer rather than a failure", async () => {
        dumpVersion = "something else entirely";
        expect((await canTakeABackup()).ok).toBe(true);
    });
});

describe("the cost of asking", () => {
    it("is paid once, because it spawns a process and every screen asks", async () => {
        const first = await canTakeABackup();
        spawnError = Object.assign(new Error("spawn pg_dump ENOENT"), { code: "ENOENT" });
        const second = await canTakeABackup();
        expect(second).toEqual(first);
    });
});
