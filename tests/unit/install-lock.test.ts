import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The install lock and the build queue decide whether installing a module
 * works at all. Two of the three defects fixed in 0.2.0 lived on this path:
 * a restart call that always threw and was always swallowed, and a build
 * whose result nothing recorded. Neither had a test.
 *
 * Two things here need care:
 *
 * 1. `getLockPool()` reaches `pg` through `eval("require")` so Turbopack
 *    never bundles it. That bypasses the ESM mock graph, so `vi.mock("pg")`
 *    would do nothing - the stub is installed on the real CJS module object
 *    instead, and restored afterwards.
 * 2. The module holds process-wide state (`installing`, `buildRunning`,
 *    `buildScheduled`, the memoised pool), so every test re-imports it after
 *    `vi.resetModules()`.
 */

const { execFileMock } = vi.hoisted(() => ({
    execFileMock: vi.fn(
        (
            _file: string,
            _args: string[],
            _opts: unknown,
            cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => { cb(null, "", ""); },
    ),
}));

vi.mock("child_process", () => ({ execFile: execFileMock, default: { execFile: execFileMock } }));

vi.mock("@/core/lib/logger", () => ({
    
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { writeSchemaState } = vi.hoisted(() => ({
    writeSchemaState: vi.fn(),
}));

vi.mock("@/core/lib/build-state", () => ({ writeSchemaState }));

// The build is staged (staged-build.ts has its own tests against a real
// directory): what matters here is that install-lock builds into the staging
// environment, marks the result ready only after a build that succeeded, and
// throws away the result of one that failed.
const { STAGED_ENV, prepareStagedBuild, markStagedBuildReady, discardStagedBuild } = vi.hoisted(() => {
    const env = { NEXT_DIST_DIR: ".next/.staging", NEXT_TSCONFIG_PATH: "tsconfig.staging.json" };
    return {
        STAGED_ENV: env,
        prepareStagedBuild: vi.fn(() => env),
        markStagedBuildReady: vi.fn(),
        discardStagedBuild: vi.fn(),
    };
});

vi.mock("@/core/lib/staged-build", () => ({ prepareStagedBuild, markStagedBuildReady, discardStagedBuild }));

type InstallLock = typeof import("@/core/lib/install-lock");

type ExecFileCb = (err: Error | null, stdout: string, stderr: string) => void;

// --- pg stub -------------------------------------------------------------

interface QueryRecord { sql: string; params?: unknown[] }

class FakeClient {
    queries: QueryRecord[] = [];
    releases = 0;

    constructor(private readonly behaviour: PgBehaviour) { }

    async query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
        this.queries.push({ sql, params });
        if (this.behaviour.queryThrows) throw new Error("connection terminated");
        if (sql.includes("pg_try_advisory_lock")) {
            return { rows: [{ locked: this.behaviour.grantsLock } as T] };
        }
        return { rows: [] };
    }

    release(): void { this.releases += 1; }
}

interface PgBehaviour {
    grantsLock: boolean;
    connectThrows: boolean;
    queryThrows: boolean;
    clients: FakeClient[];
    poolOptions: unknown[];
}

let pg: PgBehaviour;
let realPool: unknown;

function makePgModule() {
    return class FakePool {
        constructor(options: unknown) { pg.poolOptions.push(options); }
        async connect(): Promise<FakeClient> {
            if (pg.connectThrows) throw new Error("ECONNREFUSED 127.0.0.1:5432");
            const client = new FakeClient(pg);
            pg.clients.push(client);
            return client;
        }
        async end(): Promise<void> { }
    };
}

beforeEach(() => {
    pg = {
        grantsLock: true,
        connectThrows: false,
        queryThrows: false,
        clients: [],
        poolOptions: [],
    };
    // install-lock resolves pg through the CJS registry, not the ESM graph,
    // so the stub has to be installed there. The `eval("require")` mirrors
    // the production module's own deliberate use of it (see its comment on
    // getLockPool) and evaluates a fixed literal, never external input.
    const pgModule = eval("require")("pg");
    realPool = pgModule.Pool;
    pgModule.Pool = makePgModule();

    vi.spyOn(console, "error").mockImplementation(() => { });
    vi.resetModules();
});

afterEach(() => {
    eval("require")("pg").Pool = realPool;
    vi.restoreAllMocks();
    vi.useRealTimers();
    execFileMock.mockClear();
    markStagedBuildReady.mockClear();
    discardStagedBuild.mockClear();
    prepareStagedBuild.mockClear();
    writeSchemaState.mockClear();
});

async function load(): Promise<InstallLock> {
    return (await import("@/core/lib/install-lock")) as InstallLock;
}

describe("acquireInstallLock", () => {
    it("acquires the Postgres advisory lock and reports it as held", async () => {
        const mod = await load();
        expect(mod.isInstalling()).toBe(false);

        const release = await mod.acquireInstallLock();

        expect(release).toBeTypeOf("function");
        expect(mod.isInstalling()).toBe(true);
        expect(pg.clients[0].queries[0].sql).toContain("pg_try_advisory_lock");
    });

    it("passes the advisory key as a string so the bigint survives", async () => {
        const mod = await load();
        await mod.acquireInstallLock();

        const [key] = pg.clients[0].queries[0].params as string[];
        expect(typeof key).toBe("string");
        // 0x626c794d6f64496e - larger than Number.MAX_SAFE_INTEGER, so a
        // float round-trip would produce a different lock id per worker and
        // silently break mutual exclusion.
        expect(key).toBe(BigInt("0x626c794d6f64496e").toString());
        expect(Number(key)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    });

    it("unlocks on the same client it locked, then returns it to the pool", async () => {
        const mod = await load();
        const release = await mod.acquireInstallLock();

        release!();
        await vi.waitFor(() => expect(pg.clients[0].releases).toBe(1));

        // Same physical connection for both statements: an unlock issued on a
        // different session is a silent no-op and leaks the lock.
        expect(pg.clients).toHaveLength(1);
        expect(pg.clients[0].queries.map((q) => q.sql).join(" ")).toContain("pg_advisory_unlock");
        expect(mod.isInstalling()).toBe(false);
    });

    it("survives an unlock that fails because the connection is gone", async () => {
        const mod = await load();
        const release = await mod.acquireInstallLock();

        pg.queryThrows = true;
        release!();

        expect(mod.isInstalling()).toBe(false);
        await vi.waitFor(() => expect(pg.clients[0].releases).toBe(1));
    });

    it("rejects a second acquire in this worker without touching Postgres", async () => {
        const mod = await load();
        await mod.acquireInstallLock();

        expect(await mod.acquireInstallLock()).toBeNull();
        // The fast path exists to avoid a round trip per concurrent request.
        expect(pg.clients).toHaveLength(1);
    });

    it("returns null and frees the client when another process holds the lock", async () => {
        pg.grantsLock = false;
        const mod = await load();

        expect(await mod.acquireInstallLock()).toBeNull();
        expect(mod.isInstalling()).toBe(false);
        // A checked-out client that is never released would exhaust the
        // two-connection pool after two denied installs.
        expect(pg.clients[0].releases).toBe(1);
    });

    it("can be acquired again after release", async () => {
        const mod = await load();
        const release = await mod.acquireInstallLock();
        release!();

        const second = await mod.acquireInstallLock();
        expect(second).toBeTypeOf("function");
        expect(pg.clients).toHaveLength(2);
    });

    it("falls back to an in-process lock when Postgres is unreachable", async () => {
        pg.connectThrows = true;
        const mod = await load();

        const release = await mod.acquireInstallLock();

        // The setup wizard runs before a database exists; losing all mutual
        // exclusion there would be worse than a single-worker approximation.
        expect(release).toBeTypeOf("function");
        expect(mod.isInstalling()).toBe(true);
        expect(await mod.acquireInstallLock()).toBeNull();

        release!();
        expect(mod.isInstalling()).toBe(false);
    });

    it("falls back and frees the client when the lock query itself fails", async () => {
        pg.queryThrows = true;
        const mod = await load();

        const release = await mod.acquireInstallLock();

        expect(release).toBeTypeOf("function");
        expect(pg.clients[0].releases).toBe(1);
    });

    it("builds the lock pool from DATABASE_URL with a bounded size", async () => {
        process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/blysis_test";
        const mod = await load();
        await mod.acquireInstallLock();

        expect(pg.poolOptions[0]).toMatchObject({
            connectionString: "postgresql://u:p@localhost:5432/blysis_test",
            max: 2,
        });
    });

    it("creates the lock pool once and reuses it", async () => {
        const mod = await load();
        const release = await mod.acquireInstallLock();
        release!();
        await mod.acquireInstallLock();

        expect(pg.poolOptions).toHaveLength(1);
    });
});

describe("scheduleBuild", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(process, "kill").mockImplementation((() => true) as never);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    function setProduction(): void {
        vi.stubEnv("NODE_ENV", "production");
    }

    /** Run the debounce window plus the whole build chain. */
    async function drainBuild(): Promise<void> {
        await vi.advanceTimersByTimeAsync(3000);
        await vi.advanceTimersByTimeAsync(0);
    }

    function ranCommands(): string[] {
        return execFileMock.mock.calls.map(
            (c) => `${c[0]} ${(c[1] as string[]).join(" ")}`,
        );
    }

    it("does nothing outside production", async () => {
        vi.stubEnv("NODE_ENV", "development");
        const mod = await load();

        mod.scheduleBuild();
        expect(mod.isBuildPending()).toBe(false);

        await drainBuild();
        // Turbopack recompiles in dev; a production build here would be a
        // multi-minute no-op on every save.
        expect(execFileMock).not.toHaveBeenCalled();
    });

    it("runs the five build steps in order, then records and restarts", async () => {
        setProduction();
        const mod = await load();

        mod.scheduleBuild();
        expect(mod.isBuildPending()).toBe(true);
        await drainBuild();

        // Schema additions sit between the merge and the migrations because
        // migrations only alter a module's schema after its initial release -
        // the schema itself is what creates its tables the first time. Without
        // this step, installing one of the twenty-five schema-bearing modules
        // that ship no migrations/ left it enabled and tableless.
        expect(ranCommands()).toEqual([
            "npx tsx scripts/merge-schemas.ts",
            "npx tsx scripts/apply-schema-additions.ts",
            "npx tsx scripts/apply-migrations.ts",
            "npx tsx scripts/generate-registry.ts",
            "npm run build",
        ]);
        expect(markStagedBuildReady).toHaveBeenCalledTimes(1);
        expect(writeSchemaState).toHaveBeenCalledTimes(1);
        expect(mod.isBuildPending()).toBe(false);
    });

    it("replaces the process with SIGTERM, not process.exit", async () => {
        setProduction();
        const mod = await load();

        mod.scheduleBuild();
        await drainBuild();

        // Not yet: the HTTP response that triggered the install has to reach
        // the browser first, or the UI reports a failure for a build that
        // succeeded.
        expect(process.kill).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2000);
        // SIGTERM (not exit) so the shutdown registry drains Prisma and
        // clears the scheduler interval on the way out.
        expect(process.kill).toHaveBeenCalledWith(process.pid, "SIGTERM");
    });

    it("collapses a burst of installs into a single build", async () => {
        setProduction();
        const mod = await load();

        for (let i = 0; i < 37; i += 1) {
            mod.scheduleBuild();
            await vi.advanceTimersByTimeAsync(100);
        }
        await drainBuild();

        // Bulk install of 37 modules must build once, not 37 times.
        expect(ranCommands().filter((c) => c === "npm run build")).toHaveLength(1);
    });

    it.each([
        ["scripts/merge-schemas.ts", "npx tsx scripts/merge-schemas.ts"],
        ["scripts/apply-migrations.ts", "npx tsx scripts/apply-migrations.ts"],
        ["scripts/generate-registry.ts", "npx tsx scripts/generate-registry.ts"],
    ])("treats a failure in %s as non-fatal", async (script, _command) => {
        setProduction();
        execFileMock.mockImplementation(((_file: string, args: string[], _opts: unknown, cb: ExecFileCb) => {
            if ((args as string[]).includes(script)) cb(new Error(`${script} blew up`), "", "");
            else cb(null, "", "");
        }) as never);
        const mod = await load();

        mod.scheduleBuild();
        await drainBuild();

        // A stale schema or registry is recoverable; refusing to build is not.
        expect(ranCommands()).toContain("npm run build");
        expect(markStagedBuildReady).toHaveBeenCalledTimes(1);
    });

    it("skips the schema additions when the schema merge failed", async () => {
        setProduction();
        execFileMock.mockImplementation(((_file: string, args: string[], _opts: unknown, cb: ExecFileCb) => {
            if ((args as string[]).includes("scripts/merge-schemas.ts")) {
                cb(new Error("merge blew up"), "", "");
            } else {
                cb(null, "", "");
            }
        }) as never);
        const mod = await load();

        mod.scheduleBuild();
        await drainBuild();

        // A failed merge leaves prisma/schema.prisma stale or core-only. It
        // describes a database this instance does not have, so applying a
        // diff against it is the one step here that is worse to run than to
        // skip.
        expect(ranCommands()).not.toContain("npx tsx scripts/apply-schema-additions.ts");
        expect(ranCommands()).toContain("npm run build");
    });

    it("treats failed schema additions as non-fatal", async () => {
        setProduction();
        execFileMock.mockImplementation(((_file: string, args: string[], _opts: unknown, cb: ExecFileCb) => {
            if ((args as string[]).includes("scripts/apply-schema-additions.ts")) cb(new Error("apply failed"), "", "");
            else cb(null, "", "");
        }) as never);
        const mod = await load();

        mod.scheduleBuild();
        await drainBuild();

        expect(ranCommands()).toContain("npm run build");
        expect(markStagedBuildReady).toHaveBeenCalledTimes(1);
    });

    it("does not record state or restart when the build itself fails", async () => {
        setProduction();
        execFileMock.mockImplementation(((file: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
            if (file === "npm") cb(new Error("build failed"), "", "");
            else cb(null, "", "");
        }) as never);
        const mod = await load();

        mod.scheduleBuild();
        await drainBuild();
        await vi.advanceTimersByTimeAsync(5000);

        // Recording a fingerprint for a build that does not exist would make
        // the boot reconciler skip the rebuild that would have fixed it.
        expect(markStagedBuildReady).not.toHaveBeenCalled();
        expect(writeSchemaState).not.toHaveBeenCalled();
        expect(process.kill).not.toHaveBeenCalled();
        expect(mod.isBuildPending()).toBe(false);
        // The half-made build goes; the live one was never touched and is
        // still what the running server serves.
        expect(discardStagedBuild).toHaveBeenCalledTimes(1);
    });

    it("builds beside the live build, not into it", async () => {
        setProduction();
        execFileMock.mockImplementation(((_file: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
            cb(null, "", "");
        }) as never);
        const mod = await load();

        mod.scheduleBuild();
        await drainBuild();

        // Building into `.next` emptied it under the running server: every
        // visitor during an install got pages whose chunks were gone, and a
        // failed build left nothing to start.
        const build = execFileMock.mock.calls.find((c) => c[0] === "npm");
        const opts = build?.[2] as { env?: NodeJS.ProcessEnv; timeout?: number; maxBuffer?: number };
        expect(opts.env).toMatchObject(STAGED_ENV);
        // A full module set outgrew the old five minutes on a small machine,
        // and the default 1 MB output buffer kills a chatty build outright.
        expect(opts.timeout).toBeGreaterThanOrEqual(30 * 60 * 1000);
        expect(opts.maxBuffer).toBeGreaterThanOrEqual(16 * 1024 * 1024);
        expect(discardStagedBuild).not.toHaveBeenCalled();
    });

    it("schedules another build for installs that landed during one", async () => {
        setProduction();
        let releaseBuild: () => void = () => { };
        execFileMock.mockImplementation(((file: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
            if (file === "npm") { releaseBuild = () => cb(null, "", ""); }
            else cb(null, "", "");
        }) as never);
        const mod = await load();

        mod.scheduleBuild();
        await vi.advanceTimersByTimeAsync(3000);

        // A module installed while the build is running must not be left out
        // of the build that ships.
        mod.scheduleBuild();
        releaseBuild();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(3000);
        releaseBuild();
        await vi.advanceTimersByTimeAsync(0);

        expect(ranCommands().filter((c) => c === "npm run build")).toHaveLength(2);
    });

    it("reports isBuildPending while a build is running", async () => {
        setProduction();
        execFileMock.mockImplementation(((file: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
            if (file !== "npm") cb(null, "", "");
        }) as never);
        const mod = await load();

        mod.scheduleBuild();
        await vi.advanceTimersByTimeAsync(3000);
        expect(mod.isBuildPending()).toBe(true);
    });
});
