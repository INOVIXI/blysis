// @vitest-environment node
/**
 * /api/setup module installation.
 *
 * Contract: the endpoint plans before it installs. Selecting a module without
 * its prerequisites must install the prerequisites too, in dependency order,
 * and a combination that cannot work must be refused outright rather than
 * half-installed. Per-module SQL migrations must run for everything installed.
 *
 * Everything the route touches is mocked: Prisma, the filesystem (so no ZIP is
 * ever extracted into src/modules), and child_process (so no codegen or
 * migration actually runs - the test asserts on the commands instead).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The route hashes the admin password with bcrypt at cost 12 on every call,
 * which is CPU-heavy by design and is the one thing here that is not mocked.
 * On a machine running the rest of the suite in parallel that alone can pass
 * vitest's 5s default, and a test that times out mid-install leaves its
 * recorded calls behind for the next one to trip over. The work is real, so
 * the budget says so rather than the tests failing by machine load.
 */
vi.setConfig({ testTimeout: 30_000 });

const CATALOG = {
    modules: [
        { id: "currency", version: "1.0.0", dependencies: [], conflicts: [] },
        { id: "store", version: "1.0.0", dependencies: ["currency"], conflicts: [] },
        { id: "credits", version: "1.0.0", dependencies: [], conflicts: [] },
        { id: "wheel", version: "1.0.0", dependencies: ["credits"], conflicts: [] },
        { id: "leaderboard", version: "1.0.0", dependencies: ["store"], conflicts: [] },
        { id: "loop-a", version: "1.0.0", dependencies: ["loop-b"], conflicts: [] },
        { id: "loop-b", version: "1.0.0", dependencies: ["loop-a"], conflicts: [] },
    ],
};

const moduleConfigUpsert = vi.fn(async (..._args: unknown[]) => ({}));
const settingUpsert = vi.fn(async (..._args: unknown[]) => ({}));
const activityCreate = vi.fn(async (..._args: unknown[]) => ({}));
let userCount = 0;

vi.mock("@/core/lib/db", () => {
    const tx = {
        $executeRaw: async () => 0,
        user: {
            count: async () => userCount,
            create: async () => ({ id: "admin-1" }),
        },
        role: { upsert: async () => ({ id: "role-1" }) },
    };
    const prisma = {
        user: { count: async () => userCount },
        $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
        setting: { upsert: (...a: unknown[]) => settingUpsert(...a) },
        moduleConfig: { upsert: (...a: unknown[]) => moduleConfigUpsert(...a) },
        activityLog: { create: (...a: unknown[]) => activityCreate(...a) },
    };
    return { prisma, default: prisma };
});

vi.mock("@/core/lib/setup-state", () => ({ markSetupComplete: () => {} }));

const syncTranslations = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/core/lib/i18n/translation-service", () => ({
    syncModuleTranslations: (...a: unknown[]) => syncTranslations(...a),
}));
vi.mock("@/core/lib/module-cache", () => ({ invalidateModuleCache: async () => {} }));

// A minimal in-memory filesystem: the catalog reads real JSON, every ZIP
// "exists" and is a valid-looking archive, and writes go nowhere.
vi.mock("fs/promises", () => {
    const readFile = async (p: string) => {
        const target = String(p);
        if (target.endsWith("index.json")) return JSON.stringify(CATALOG);
        // The route reads each extracted manifest for the module's name and
        // its translations. The path comes from `path.join`, so on Windows
        // its separators are backslashes and the id is found by either.
        if (target.endsWith("module.json")) {
            const id = target.split(/[\\/]/).slice(-2)[0];
            return JSON.stringify({
                id,
                name: `${id} module`,
                translations: { en: { [id]: { title: id } } },
            });
        }
        // Minimal local ZIP header so the route's magic-byte check passes.
        return Buffer.from([0x50, 0x4b, 0x03, 0x04, ...new Array(64).fill(0)]);
    };
    const api = {
        readFile,
        access: async (p: string) => {
            const target = String(p);
            // The marketplace ZIP exists, and after "extraction" so does the
            // manifest the route verifies. The module directory itself must
            // not, or the route short-circuits before extracting.
            if (target.endsWith(".zip") || target.endsWith("module.json")) return undefined;
            throw new Error("ENOENT");
        },
        mkdir: async () => undefined,
        writeFile: async () => undefined,
        rm: async () => undefined,
    };
    return { ...api, default: api };
});

// One manifest entry is enough, but it has to look like one: the route runs
// the archive through `validateZipEntries` before writing anything, and that
// reads an entry's attributes and its size header as well as its name.
vi.mock("adm-zip", () => {
    const data = Buffer.from('{"id":"x"}');
    class FakeZip {
        getEntries() {
            return [
                {
                    isDirectory: false,
                    entryName: "module.json",
                    attr: 0,
                    header: { size: data.length, compressedSize: data.length },
                    getData: () => data,
                },
            ];
        }
    }
    return { default: FakeZip };
});

const execCalls: string[] = [];
vi.mock("child_process", async () => {
    const actual = await vi.importActual<typeof import("child_process")>("child_process");
    return {
        ...actual,
        execFileSync: vi.fn((cmd: string, args: string[]) => {
            execCalls.push([cmd, ...(args ?? [])].join(" "));
            return Buffer.from("");
        }),
    };
});

import { NextRequest } from "next/server";

function body(modules: string[], password = "Correct horse battery 9") {
    return {
        admin: { email: "a@example.com", username: "admin", password },
        site: { siteName: "Test", siteDescription: "", defaultLocale: "en" },
        theme: "flat",
        modules,
    };
}

async function post(modules: string[], password?: string) {
    const { POST } = await import("@/app/api/setup/route");
    const req = new NextRequest("http://example.com/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body(modules, password)),
    });
    const res = await POST(req);
    return { res, json: (await res.json()) as Record<string, unknown> };
}

/** Module ids in the order the route wrote their ModuleConfig rows. */
function installedInOrder(): string[] {
    return moduleConfigUpsert.mock.calls.map(
        (c) => (c[0] as { where: { id: string } }).where.id,
    );
}

beforeEach(() => {
    userCount = 0;
    execCalls.length = 0;
    moduleConfigUpsert.mockClear();
    syncTranslations.mockClear();
    settingUpsert.mockClear();
    activityCreate.mockClear();
});

describe("/api/setup - install planning", () => {
    it("installs a transitive dependency the operator did not select", async () => {
        const { res, json } = await post(["store"]);
        expect(res.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.installedModules).toEqual(["currency", "store"]);
        expect(json.autoAdded).toEqual(["currency"]);
    });

    it("installs prerequisites before the modules that need them", async () => {
        await post(["leaderboard", "wheel"]);
        const order = installedInOrder();
        expect(order.indexOf("currency")).toBeLessThan(order.indexOf("store"));
        expect(order.indexOf("store")).toBeLessThan(order.indexOf("leaderboard"));
        expect(order.indexOf("credits")).toBeLessThan(order.indexOf("wheel"));
    });

    it("refuses a circular selection instead of installing part of it", async () => {
        const { res, json } = await post(["loop-a"]);
        expect(res.status).toBe(400);
        expect(String(json.error)).toMatch(/cannot be installed together/i);
        expect(installedInOrder()).toEqual([]);
    });

    it("refuses a module that is not in the catalog", async () => {
        const { res, json } = await post(["does-not-exist"]);
        expect(res.status).toBe(400);
        const issues = json.issues as Array<{ kind: string; message: string }>;
        expect(issues.some((i) => i.kind === "unknown")).toBe(true);
        expect(installedInOrder()).toEqual([]);
    });

    it("runs SQL migrations for every module it installed", async () => {
        await post(["store"]);
        const migrationCalls = execCalls.filter((c) => c.includes("apply-migrations"));
        expect(migrationCalls.some((c) => c.includes("--module=currency"))).toBe(true);
        expect(migrationCalls.some((c) => c.includes("--module=store"))).toBe(true);
    });

    it("loads each installed module's translations", async () => {
        // Without this the UI renders raw keys ("store.title") for every
        // module the wizard installed - module strings are database rows,
        // not bundled JSON.
        await post(["store"]);
        const synced = syncTranslations.mock.calls.map((c) => c[0]);
        expect(synced).toEqual(["currency", "store"]);
        expect(syncTranslations.mock.calls[1][1]).toEqual({ en: { store: { title: "store" } } });
    });

    it("records each module's declared name, not just its id", async () => {
        await post(["currency"]);
        const created = (moduleConfigUpsert.mock.calls[0][0] as { create: { name: string } }).create;
        expect(created.name).toBe("currency module");
    });

    it("regenerates the registry once modules are installed", async () => {
        await post(["currency"]);
        expect(execCalls.some((c) => c.includes("generate-registry"))).toBe(true);
    });

    it("skips module machinery entirely for an empty selection", async () => {
        const { res, json } = await post([]);
        expect(res.status).toBe(200);
        expect(json.installedModules).toEqual([]);
        expect(json.autoAdded).toEqual([]);
        expect(execCalls).toEqual([]);
    });

    it("still refuses to run once a user exists", async () => {
        userCount = 1;
        const { res } = await post([]);
        expect(res.status).toBe(409);
    });
});

/**
 * The first administrator is the most privileged account the site will ever
 * have, and the setup schema used to hold it to eight characters and nothing
 * else while a visitor registering an ordinary account answered to the full
 * policy. `12345678` and `password` were both accepted here and refused there.
 */
describe("/api/setup - the first administrator's password", () => {
    it("refuses the eight-character password the schema used to accept", async () => {
        const { res, json } = await post([], "12345678");
        expect(res.status).toBe(400);
        expect(String(json.error)).toMatch(/at least 10 characters/i);
    });

    it("refuses one that is long enough but on the common list", async () => {
        const { res, json } = await post([], "Password123");
        expect(res.status).toBe(400);
        expect(json.code).toBe("too_common");
    });

    it("refuses one with no digit", async () => {
        const { res, json } = await post([], "Correcthorsebattery");
        expect(res.status).toBe(400);
        expect(json.code).toBe("missing_digit");
    });

    it("creates no account when the password is refused", async () => {
        await post(["store"], "12345678");
        expect(moduleConfigUpsert).not.toHaveBeenCalled();
        expect(execCalls).toEqual([]);
    });

    it("accepts one that clears the policy", async () => {
        const { res } = await post([]);
        expect(res.status).toBe(200);
    });
});
