// @vitest-environment node
/**
 * What the update endpoint accepts, and what it refuses.
 *
 * Pressing the button ends with another container pulling an image and
 * recreating this one, so the endpoint is the narrowest part of that path.
 * The request names a *version*; the tag that reaches the updater is the one
 * the release feed carries for that version. A request that names its own tag
 * gets it ignored, which is the whole point: there is no request body that can
 * make the updater pull something the feed does not list.
 *
 * The rest is the ordinary shape of an admin mutation - who may call it, what
 * happens when one is already running, and what is written down about it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let user: { id: string; role: string } | null = { id: "admin-1", role: "admin" };
let admin = true;
const activity: { action: string }[] = [];
const created: Record<string, unknown>[] = [];

vi.mock("@/core/lib/auth", () => ({ auth: async () => (user ? { user } : null) }));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async () => admin }));
vi.mock("@/core/lib/activity-log", () => ({
    logActivity: (entry: { action: string }) => { activity.push(entry); },
}));
let backupThrows: Error | null = null;
const backups: string[] = [];
let maintenance = { enabled: false, message: "", allowedRoles: ["admin"] };

vi.mock("@/core/lib/backup", () => ({
    createBackup: async (type: string, notes: string) => {
        if (backupThrows) throw backupThrows;
        backups.push(notes);
        return { id: "b1", filename: "dump.sql.gz", sizeBytes: 10, createdAt: new Date(), type };
    },
}));
vi.mock("@/core/lib/maintenance", () => ({
    getMaintenanceConfig: async () => maintenance,
    setMaintenanceConfig: async (next: typeof maintenance) => { maintenance = next; },
}));
vi.mock("@/core/lib/db", () => ({
    prisma: {
        coreUpdate: {
            create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: "u1", ...data }; },
            findMany: async () => [],
            updateMany: async () => ({ count: 0 }),
        },
    },
}));

/*
 * Two releases, both far above anything this product will ever be.
 *
 * They used to be 0.3.0 and 0.9.0, and the second needed the first before it.
 * That is the case being tested and it depended on the version in
 * `package.json` being below both: the day the product reached 0.3.0, the
 * step this file exists to check stopped being a step, and ten assertions
 * went red for a reason that had nothing to do with the endpoint.
 *
 * A fixture that a release can walk into is a fixture with a date on it.
 */
const NEXT = "900.1.0";
const AFTER_NEXT = "900.2.0";

const FEED = {
    releases: [
        { version: NEXT, tag: NEXT, publishedAt: "2026-09-01T00:00:00Z", notes: "Faster.", security: false, channel: "stable" },
        { version: AFTER_NEXT, tag: AFTER_NEXT, publishedAt: "2026-09-05T00:00:00Z", notes: "Big.", security: false, channel: "stable", minVersion: NEXT },
    ],
};

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "blysis-update-route-"));
    process.env.BLYSIS_UPDATE_DIR = dir;
    user = { id: "admin-1", role: "admin" };
    admin = true;
    activity.length = 0;
    created.length = 0;
    backups.length = 0;
    backupThrows = null;
    maintenance = { enabled: false, message: "", allowedRoles: ["admin"] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(FEED), { status: 200 })));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.BLYSIS_UPDATE_DIR;
    vi.unstubAllGlobals();
});

const { GET, POST } = await import("@/app/api/v1/admin/updates/route");
const { NextRequest } = await import("next/server");

const ask = (body: unknown) =>
    POST(new NextRequest("http://example.com/api/v1/admin/updates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    }));

function intentOnDisk(): Record<string, unknown> | null {
    const p = path.join(dir, "intent.json");
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

describe("who may look and who may press", () => {
    it("tells a stranger nothing", async () => {
        user = null;
        expect((await GET()).status).toBe(401);
        expect((await ask({ version: NEXT })).status).toBe(401);
    });

    it("tells a signed-in member nothing either", async () => {
        admin = false;
        expect((await GET()).status).toBe(403);
        expect((await ask({ version: NEXT })).status).toBe(403);
        expect(intentOnDisk()).toBeNull();
    });
});

describe("what the screen is told", () => {
    it("names the version running and the one available", async () => {
        const body = await (await GET()).json();
        expect(body.current).toMatch(/^\d+\.\d+\.\d+$/);
        expect(body.latest.version).toBe(NEXT);
        expect(body.latest.tag).toBe(NEXT);
    });

    it("says nothing is available when the feed cannot be read", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
        const body = await (await GET()).json();
        expect(body.latest).toBeNull();
        expect(body.feedReadable).toBe(false);
    });
});

describe("asking for a version", () => {
    it("starts the update and records it", async () => {
        const res = await ask({ version: NEXT });
        expect(res.status).toBe(202);

        expect(intentOnDisk()).toMatchObject({ tag: NEXT, toVersion: NEXT, state: "requested", requestedBy: "admin-1" });
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({ toVersion: NEXT, tag: NEXT, requestedBy: "admin-1" });
        expect(activity.map((a) => a.action)).toContain("core.update.request");
    });

    it("ignores a tag the caller supplies", async () => {
        // The one assertion this file exists for.
        await ask({ version: NEXT, tag: "evil:latest" });
        expect(intentOnDisk()).toMatchObject({ tag: NEXT });
    });

    it("refuses a version the feed does not list", async () => {
        for (const version of ["0.4.0", "latest", "", "../../etc"]) {
            const res = await ask({ version });
            expect(res.status, version).toBe(400);
        }
        expect(intentOnDisk()).toBeNull();
    });

    it("refuses to go backwards or sideways", async () => {
        const res = await ask({ version: "0.0.1" });
        expect(res.status).toBe(400);
        expect(intentOnDisk()).toBeNull();
    });

    it("refuses a jump the release says needs a step first, and names it", async () => {
        const res = await ask({ version: AFTER_NEXT });
        expect(res.status).toBe(409);
        expect((await res.json()).blockedBy).toBe(NEXT);
        expect(intentOnDisk()).toBeNull();
    });

    it("refuses a second update while one is in flight", async () => {
        expect((await ask({ version: NEXT })).status).toBe(202);
        const second = await ask({ version: NEXT });
        expect(second.status).toBe(409);
        expect(created).toHaveLength(1);
    });
});

describe("what happens before the image is pulled", () => {
    it("takes a dump first, because that is the part no rollback returns", async () => {
        await ask({ version: NEXT });
        expect(backups).toEqual([`Before updating to ${NEXT}`]);
    });

    it("does not start when the dump fails", async () => {
        backupThrows = new Error("pg_dump was not found on the server.");

        const res = await ask({ version: NEXT });

        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("backup_failed");
        expect(intentOnDisk()).toBeNull();
        expect(maintenance.enabled).toBe(false);
    });

    it("starts anyway when the operator says they back up elsewhere", async () => {
        backupThrows = new Error("pg_dump was not found on the server.");

        const res = await ask({ version: NEXT, skipBackup: true });

        expect(res.status).toBe(202);
        expect(backups).toEqual([]);
    });

    it("puts the site into maintenance for the swap", async () => {
        await ask({ version: NEXT });
        expect(maintenance.enabled).toBe(true);
        expect(intentOnDisk()).toMatchObject({ maintenanceRestore: true });
    });

    it("leaves an already-closed site closed afterwards", async () => {
        // An operator who was in maintenance before the update did not ask
        // this to take them out of it.
        maintenance = { enabled: true, message: "Back soon", allowedRoles: ["admin"] };

        await ask({ version: NEXT });

        expect(maintenance).toMatchObject({ enabled: true, message: "Back soon" });
        expect(intentOnDisk()).toMatchObject({ maintenanceRestore: false });
    });
});
