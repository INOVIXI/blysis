import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The GDPR export is the one place the platform hands a user everything it
 * knows about them. Two failures matter and neither is visible from the
 * outside: shipping a secret (password hash, 2FA seed) that should never
 * leave the database, and silently omitting a module's tables so the export
 * is incomplete but looks fine.
 */

interface FindCall { model: string; where: Record<string, unknown>; select?: Record<string, true> }

let findCalls: FindCall[];
let userSelect: Record<string, unknown> | null;
let userRow: unknown;
let rowsByModel: Record<string, unknown[]>;
let failingModels: Set<string>;
let installedModels: Set<string>;
let bogusModels: Set<string>;
let uniqueModels: Set<string>;
let uniqueRow: unknown;
let uniqueCall: { model: string; where: Record<string, unknown>; select?: Record<string, true> } | null;
let moduleTables: { model: string; key: string; column: string; module: string }[];

vi.mock("@/core/generated/module-registry", () => ({
    get ModuleUserDataTables() { return moduleTables; },
}));

vi.mock("@/core/lib/db", () => {
    const target = {
        user: {
            findUnique: async (args: { select: Record<string, unknown> }) => {
                userSelect = args.select;
                return userRow;
            },
        },
    } as Record<string, unknown>;

    const prisma = new Proxy(target, {
        get(obj, prop: string) {
            if (prop in obj) return obj[prop];
            if (bogusModels.has(prop)) return { count: () => 0 };
            if (!installedModels.has(prop)) return undefined;
            return {
                findMany: async (args: { where: Record<string, unknown>; select?: Record<string, true> }) => {
                    if (failingModels.has(prop)) throw new Error(`${prop} exploded`);
                    findCalls.push({ model: prop, where: args.where, select: args.select });
                    return rowsByModel[prop] ?? [];
                },
                // Only the models that say they have one. A Prisma client
                // generated without a model answers `undefined` for it, and a
                // delegate that is there but has no `findUnique` is the shape
                // an older client leaves behind - the export has to survive
                // both, so both stay reachable from here.
                ...(uniqueModels.has(prop)
                    ? {
                        findUnique: async (args: { where: Record<string, unknown>; select?: Record<string, true> }) => {
                            if (failingModels.has(prop)) throw new Error(`${prop} exploded`);
                            uniqueCall = { model: prop, where: args.where, select: args.select };
                            return uniqueRow;
                        },
                    }
                    : {}),
            };
        },
        has(obj, prop: string) {
            return prop in obj || installedModels.has(prop) || bogusModels.has(prop);
        },
    });

    return { prisma };
});

/**
 * Every core delegate the export reads. `linkedAccount` is not among them
 * any more: it is `member-profiles`' table, and core hardcoding a module's
 * model was the thing the registry exists to avoid. It now reaches the
 * bundle through that module's own manifest, like every other module table.
 */
const CORE_MODELS = [
    "activityFeedItem", "userSession", "userWarning", "notificationPreference",
    "revision", "account", "apiKey", "mediaItem", "conversationParticipant",
    "message", "activityLog",
];

beforeEach(() => {
    findCalls = [];
    userSelect = null;
    userRow = { id: "usr_1", email: "a@b.c" };
    rowsByModel = {};
    failingModels = new Set();
    bogusModels = new Set();
    installedModels = new Set(CORE_MODELS);
    uniqueModels = new Set();
    uniqueRow = null;
    uniqueCall = null;
    moduleTables = [];
});

async function exportUserData(userId: string) {
    const mod = await import("@/core/lib/user-data-export");
    return mod.exportUserData(userId);
}

describe("exportUserData", () => {
    it("never selects the password hash or 2FA secret", async () => {
        await exportUserData("usr_1");

        // An explicit allowlist, so a column added to User later cannot leak
        // into an export by default.
        expect(Object.keys(userSelect!)).not.toContain("password");
        expect(Object.keys(userSelect!)).not.toContain("twoFactorSecret");
        expect(Object.keys(userSelect!)).not.toContain("twoFactorBackupCodes");
        expect(userSelect).toMatchObject({ id: true, email: true, username: true });
    });

    it("collects every core table on the right join column", async () => {
        await exportUserData("usr_1");

        expect(findCalls.map((c) => c.model).sort()).toEqual([...CORE_MODELS].sort());
        // activityFeedItem, revision and message join through the *author*,
        // not the subject; the wrong column silently returns an empty export.
        expect(findCalls.find((c) => c.model === "activityFeedItem")!.where).toEqual({ actorId: "usr_1" });
        expect(findCalls.find((c) => c.model === "revision")!.where).toEqual({ authorId: "usr_1" });
        expect(findCalls.find((c) => c.model === "message")!.where).toEqual({ authorId: "usr_1" });
        expect(findCalls.find((c) => c.model === "mediaItem")!.where).toEqual({ uploadedById: "usr_1" });
        expect(findCalls.find((c) => c.model === "userWarning")!.where).toEqual({ userId: "usr_1" });
    });

    it("asks for named columns, so no core table answers with its secrets", async () => {
        await exportUserData("usr_1");

        // Prisma returns every column when a query names no select. The
        // sessions table answered with `tokenId`, the key a session is
        // looked up by when it is checked for revocation.
        for (const call of findCalls) {
            expect(call.select, `${call.model} was read with no select`).toBeTruthy();
        }
        const sessions = findCalls.find((c) => c.model === "userSession")!.select!;
        expect(Object.keys(sessions)).not.toContain("tokenId");
        expect(Object.keys(sessions)).toContain("ipAddress");
    });

    it("reads a module table whole, because a manifest cannot name columns", async () => {
        moduleTables = [
            { model: "blogArticle", key: "blog.articles", column: "authorId", module: "blog" },
        ];
        installedModels = new Set([...CORE_MODELS, "blogArticle"]);
        rowsByModel = { blogArticle: [{ id: "a1" }] };

        await exportUserData("usr_1");

        expect(findCalls.find((c) => c.model === "blogArticle")!.select).toBeUndefined();
    });

    it("returns the user row it read", async () => {
        userRow = { id: "usr_1", email: "a@b.c", role: { name: "admin" } };
        const result = await exportUserData("usr_1");
        expect(result.user).toEqual(userRow);
    });

    it("returns a null user rather than throwing when the id is unknown", async () => {
        userRow = null;
        const result = await exportUserData("ghost");
        expect(result.user).toBeNull();
        expect(result.modules).toEqual({});
    });

    it("includes module tables from the generated registry, keyed by manifest key", async () => {
        moduleTables = [
            { model: "blogArticle", key: "blog.articles", column: "authorId", module: "blog" },
            { model: "order", key: "store.orders", column: "userId", module: "store" },
        ];
        installedModels = new Set([...CORE_MODELS, "blogArticle", "order"]);
        rowsByModel = { blogArticle: [{ id: "a1" }], order: [{ id: "o1" }, { id: "o2" }] };

        const result = await exportUserData("usr_1");

        expect(result.modules).toEqual({
            "blog.articles": [{ id: "a1" }],
            "store.orders": [{ id: "o1" }, { id: "o2" }],
        });
        expect(findCalls.find((c) => c.model === "blogArticle")!.where).toEqual({ authorId: "usr_1" });
    });

    it("omits module keys with no rows instead of emitting empty arrays", async () => {
        moduleTables = [
            { model: "blogArticle", key: "blog.articles", column: "authorId", module: "blog" },
        ];
        installedModels = new Set([...CORE_MODELS, "blogArticle"]);

        const result = await exportUserData("usr_1");
        // A wall of empty keys makes the export unreadable and implies the
        // user has data in modules they never touched.
        expect(result.modules).toEqual({});
    });

    it("skips a module whose table is not in the installed client", async () => {
        moduleTables = [
            { model: "forumTopic", key: "forum.topics", column: "authorId", module: "forum" },
        ];

        const result = await exportUserData("usr_1");
        // The registry is generated at build time; a module uninstalled since
        // must contribute nothing rather than crash the whole export.
        expect(result.modules).toEqual({});
    });

    it("skips a client property that exists but cannot findMany", async () => {
        moduleTables = [
            { model: "$transaction", key: "bogus", column: "userId", module: "x" },
        ];
        bogusModels = new Set(["$transaction"]);

        const result = await exportUserData("usr_1");
        expect(result.modules).toEqual({});
    });

    it("degrades to an empty list when one query fails", async () => {
        failingModels = new Set(["userSession"]);

        const result = await exportUserData("usr_1");

        // A dropped table must not deny the user the rest of their data.
        expect(result.sessions).toEqual([]);
        expect(findCalls.map((c) => c.model)).not.toContain("userSession");
        expect(findCalls).toHaveLength(CORE_MODELS.length - 1);
    });

    it("returns every documented top-level key even with nothing installed", async () => {
        installedModels = new Set();

        const result = await exportUserData("usr_1");

        // The README below promises these names; a missing key would make
        // the bundle contradict its own documentation.
        expect(Object.keys(result).sort()).toEqual([
            "accounts", "activityFeed", "apiKeys", "auditLog", "conversations",
            "dashboardLayout", "media", "messages", "modules",
            "notificationPrefs", "pendingEmailChange", "resourcePermissions", "restrictions",
            "revisions", "roles", "sessions", "user", "warnings",
        ]);
    });

    /**
     * The dashboard arrangement is the one thing in the bundle that is a
     * single row rather than a table, so it is the one thing fetched through
     * `findUnique`. Every test above ran against a client with no `setting`
     * model at all, which meant the only path ever exercised was the guard
     * that gives up - the fetch itself, and its failure, were never run.
     */
    it("puts the user's dashboard layout in the bundle", async () => {
        installedModels.add("setting");
        uniqueModels.add("setting");
        uniqueRow = { value: { widgets: ["credits"] }, updatedAt: new Date(0) };

        const result = await exportUserData("usr_1");

        // Keyed by the user, not joined on a column: the wrong key hands one
        // user another user's layout.
        expect(uniqueCall).toEqual({
            model: "setting",
            where: { key: "dashboard_layout:usr_1" },
            select: { value: true, updatedAt: true },
        });
        expect(result.dashboardLayout).toEqual(uniqueRow);
    });

    it("still exports everything else when that one row cannot be read", async () => {
        installedModels.add("setting");
        uniqueModels.add("setting");
        failingModels.add("setting");

        const result = await exportUserData("usr_1");

        // A layout is a convenience. Losing it must not cost the user the
        // export they asked for.
        expect(result.dashboardLayout).toBeNull();
        expect(result.user).toEqual({ id: "usr_1", email: "a@b.c" });
    });
});

describe("buildExportReadme", () => {
    it("names the user and the export time", async () => {
        const { buildExportReadme } = await import("@/core/lib/user-data-export");
        const at = new Date("2026-09-01T12:00:00.000Z");

        const readme = buildExportReadme("usr_1", at, "Acme Games");

        expect(readme).toContain("User ID: usr_1");
        expect(readme).toContain("Exported at: 2026-09-01T12:00:00.000Z");
    });

    it("documents every key the JSON dump actually contains", async () => {
        const { buildExportReadme } = await import("@/core/lib/user-data-export");
        const readme = buildExportReadme("usr_1", new Date(), "Acme Games");

        for (const key of [
            "user", "activityFeed", "sessions", "warnings", "notificationPrefs",
            "revisions", "accounts", "apiKeys", "media", "conversations",
            "messages", "auditLog", "modules",
        ]) {
            expect(readme).toContain(key);
        }
    });

    it("states that secrets are omitted and points at the erasure right", async () => {
        const { buildExportReadme } = await import("@/core/lib/user-data-export");
        const readme = buildExportReadme("usr_1", new Date(), "Acme Games");

        expect(readme).toMatch(/password hash and 2FA secrets/i);
        expect(readme).toMatch(/right to be forgotten/i);
    });
});
