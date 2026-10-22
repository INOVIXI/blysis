// @vitest-environment node
/**
 * Which releases a site is offered is the operator's choice, made on the
 * update screen.
 *
 * The channel used to be an environment variable and nothing else, which is
 * a choice an operator who never opens `.env` does not know they have. The
 * screen now sets it. The variable still wins when it is set, because an
 * operator who pinned a channel on the server meant it, and the screen says
 * it is pinned rather than offering a switch that does nothing.
 *
 * The channel also bounds what the install button may ask for: a site on the
 * stable channel is not moved to a beta by a request that names one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const settings = new Map<string, unknown>();

vi.mock("@/core/lib/db", () => ({
    prisma: {
        setting: {
            findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
                settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
            upsert: vi.fn(async ({ where, update }: { where: { key: string }; update: { value: unknown } }) => {
                settings.set(where.key, update.value);
                return {};
            }),
        },
        coreUpdate: { findMany: vi.fn(async () => []), create: vi.fn(async () => ({})) },
    },
}));
vi.mock("@/core/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "admin-1", role: "admin" } })) }));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: vi.fn(async () => true) }));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("@/core/lib/logger", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/core/lib/core-update", () => ({
    readIntent: vi.fn(async () => null),
    writeIntent: vi.fn(async () => ({ state: "requested" })),
    canStart: () => true,
}));
vi.mock("@/core/lib/backup", () => ({ createBackup: vi.fn(async () => ({ filename: "b.sql.gz", sizeBytes: 1 })) }));
vi.mock("@/core/lib/maintenance", () => ({
    getMaintenanceConfig: vi.fn(async () => ({ enabled: false, message: "", allowedRoles: [] })),
    setMaintenanceConfig: vi.fn(async () => undefined),
}));

const { GET, PATCH, POST } = await import("@/app/api/v1/admin/updates/route");
const { isAdmin } = await import("@/core/lib/permissions");
const pkg = (await import("../../package.json")).default as { version: string };

/** A feed with a release and a beta, both newer than whatever this tree is. */
const NEXT = "99.0.0";
const BETA = "99.1.0-beta.1";
const feed = {
    releases: [
        { version: NEXT, tag: NEXT, publishedAt: "2026-10-01T00:00:00Z" },
        { version: BETA, tag: BETA, publishedAt: "2026-10-02T00:00:00Z" },
    ],
};

function send(method: string, body: unknown) {
    return new NextRequest("https://site.example/api/v1/admin/updates", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

async function state() {
    return (await GET()).json() as Promise<{ channel: string; channelPinned: boolean; latest: { version: string; stage: string } | null }>;
}

beforeEach(() => {
    settings.clear();
    vi.mocked(isAdmin).mockReset().mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(feed))));
    vi.stubEnv("BLYSIS_UPDATE_CHANNEL", "");
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("the update channel", () => {
    it("is stable until somebody chooses otherwise", async () => {
        expect(await state()).toMatchObject({ channel: "stable", channelPinned: false, latest: { version: NEXT, stage: "stable" } });
    });

    it("is chosen on the screen, and the screen then offers betas", async () => {
        const res = await PATCH(send("PATCH", { channel: "beta" }));

        expect(res.status).toBe(200);
        expect(await state()).toMatchObject({ channel: "beta", latest: { version: BETA, stage: "beta" } });
    });

    it("can be chosen back", async () => {
        await PATCH(send("PATCH", { channel: "beta" }));
        await PATCH(send("PATCH", { channel: "stable" }));

        expect((await state()).channel).toBe("stable");
    });

    it("refuses a channel that is not one", async () => {
        const res = await PATCH(send("PATCH", { channel: "nightly" }));

        expect(res.status).toBe(400);
        expect((await state()).channel).toBe("stable");
    });

    it("is changed only by an administrator", async () => {
        vi.mocked(isAdmin).mockResolvedValueOnce(false);
        const res = await PATCH(send("PATCH", { channel: "beta" }));

        expect(res.status).toBe(403);
        expect((await state()).channel).toBe("stable");
    });

    it("follows the server's pin over the screen, and says it is pinned", async () => {
        settings.set("update_channel", "stable");
        vi.stubEnv("BLYSIS_UPDATE_CHANNEL", "beta");

        expect(await state()).toMatchObject({ channel: "beta", channelPinned: true });
    });

    it("cannot be changed on the screen while the server pins it", async () => {
        vi.stubEnv("BLYSIS_UPDATE_CHANNEL", "stable");
        const res = await PATCH(send("PATCH", { channel: "beta" }));

        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("channel_pinned");
    });

    it("ignores a pin that names no channel", async () => {
        vi.stubEnv("BLYSIS_UPDATE_CHANNEL", "nightly");
        expect(await state()).toMatchObject({ channel: "stable", channelPinned: false });
    });
});

describe("the install button", () => {
    it("does not move a stable site to a beta it was never offered", async () => {
        const res = await POST(send("POST", { version: BETA, skipBackup: true }));

        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("not_on_channel");
    });

    it("installs a beta for a site that follows betas", async () => {
        await PATCH(send("PATCH", { channel: "beta" }));
        const res = await POST(send("POST", { version: BETA, skipBackup: true }));

        expect(res.status).toBe(202);
    });

    it("still installs a release, which every channel is offered", async () => {
        const res = await POST(send("POST", { version: NEXT, skipBackup: true }));
        expect(res.status).toBe(202);
    });
});

it("runs against a tree older than the feed's releases", () => {
    // The feed above is only newer than this tree while the tree is below 99.
    expect(Number(pkg.version.split(".")[0])).toBeLessThan(99);
});
