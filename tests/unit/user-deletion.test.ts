import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * "Right to be forgotten" is irreversible and legally load-bearing: too
 * little deletion is a GDPR failure, too much destroys the public record
 * (forum topics, orders, moderation history) that the design deliberately
 * keeps. Neither direction is recoverable once it has run, and until now
 * nothing tested either.
 */

interface DeleteCall { model: string; where: Record<string, unknown> }
interface UserDataTable { model: string; key: string; column: string; erasure?: string; module: string }

/** What the installed modules say about their own tables. */
let moduleTables: UserDataTable[];

const deleteCalls: DeleteCall[] = [];
let userRow: { id: string; isDeleted: boolean; isBanned?: boolean; role?: { name: string } | null } | null;
/** How many administrators the install has that can still sign in. */
let usableAdmins: number;
let updateArgs: { where: unknown; data: Record<string, unknown> } | null;
let updateThrows: unknown = null;
let findThrows: unknown = null;
/** Models whose deleteMany rejects, keyed by model name. */
let failingModels: Set<string>;
/** Models the generated client exposes. Anything else is "not installed". */
let installedModels: Set<string>;
/** Client properties that exist but are not delegates (e.g. $extends). */
let bogusModels: Set<string>;
/** Ordered log of every write, so purge-before-anonymise is observable. */
let opLog: string[];

function makeDelegate(model: string) {
    return {
        deleteMany: async (args: { where: Record<string, unknown> }) => {
            if (failingModels.has(model)) throw new Error(`${model} is gone`);
            opLog.push(`delete:${model}`);
            deleteCalls.push({ model, where: args.where });
            return { count: 1 };
        },
    };
}

/** Actions fired through the hook system, in order. */
let firedHooks: { name: string; payload: unknown }[];
let hookThrows: boolean;

vi.mock("@/core/lib/hooks", () => ({
    HookNames: { USER_DELETED: "user.deleted" },
    doActionAsync: async (name: string, payload: unknown) => {
        if (hookThrows) throw new Error("a listener exploded");
        opLog.push(`hook:${name}`);
        firedHooks.push({ name, payload });
    },
}));

vi.mock("@/core/generated/module-registry", () => ({
    get ModuleUserDataTables() { return moduleTables; },
}));

vi.mock("@/core/lib/db", () => {
    const target = {
        user: {
            findUnique: async () => {
                if (findThrows) throw findThrows;
                return userRow;
            },
            count: async () => usableAdmins,
            update: async (args: { where: unknown; data: Record<string, unknown> }) => {
                if (updateThrows) throw updateThrows;
                opLog.push("update:user");
                updateArgs = args;
                return {};
            },
        },
    } as Record<string, unknown>;

    // A Proxy stands in for the generated Prisma client: which model
    // delegates exist depends on which modules are installed, and the
    // module under test probes for them by string.
    const prisma = new Proxy(target, {
        get(obj, prop: string) {
            if (prop in obj) return obj[prop];
            if (bogusModels.has(prop)) return { $extends: () => { } };
            if (installedModels.has(prop)) return makeDelegate(prop);
            return undefined;
        },
        has(obj, prop: string) {
            return prop in obj || installedModels.has(prop) || bogusModels.has(prop);
        },
    });

    return { prisma };
});

/** Core's own private tables, in the order the purge runs them. */
const CORE_PRIVATE_MODELS = [
    "userSession", "notificationPreference", "account",
    "session", "apiKey", "message", "conversationParticipant",
];

/**
 * The six module tables core used to name in its own source, now declared
 * by the five modules that own them.
 */
const MODULE_TABLES: UserDataTable[] = [
    { model: "linkedAccount", key: "memberProfiles.linkedAccounts", column: "userId", erasure: "purge", module: "member-profiles" },
    { model: "notification", key: "notifications.items", column: "userId", erasure: "purge", module: "in-app-notifications" },
    { model: "cartItem", key: "store.cart", column: "userId", erasure: "purge", module: "store" },
    { model: "order", key: "store.orders", column: "userId", erasure: "retain", module: "store" },
    { model: "forumTopicLike", key: "forum.topicLikes", column: "userId", erasure: "purge", module: "forum" },
    { model: "forumPostLike", key: "forum.postLikes", column: "userId", erasure: "purge", module: "forum" },
    { model: "forumTopic", key: "forum.topics", column: "authorId", erasure: "retain", module: "forum" },
    { model: "suggestionVote", key: "suggestions.votes", column: "userId", erasure: "purge", module: "suggestions" },
];

const MODULE_PRIVATE_MODELS = MODULE_TABLES.filter((t) => t.erasure === "purge").map((t) => t.model);
const ALL_PRIVATE_MODELS = [...CORE_PRIVATE_MODELS, ...MODULE_PRIVATE_MODELS];

/** Models the design says must survive an erasure. */
const PUBLIC_RECORD_MODELS = [
    "forumTopic", "forumPost", "blogArticle", "order", "userWarning",
    "activityFeedItem", "supportTicket", "revision",
];

beforeEach(() => {
    deleteCalls.length = 0;
    userRow = { id: "usr_1", isDeleted: false };
    // Two, so the last-administrator guard is not the thing under test in
    // every other case here.
    usableAdmins = 2;
    updateArgs = null;
    updateThrows = null;
    findThrows = null;
    failingModels = new Set();
    bogusModels = new Set();
    opLog = [];
    firedHooks = [];
    hookThrows = false;
    moduleTables = [...MODULE_TABLES];
    installedModels = new Set([...ALL_PRIVATE_MODELS, ...PUBLIC_RECORD_MODELS]);
});

async function softDeleteUser(...args: [string, string?]) {
    const mod = await import("@/core/lib/user-deletion");
    return mod.softDeleteUser(...args);
}

describe("what a module says about its own tables", () => {
    async function purgeTargets(tables?: UserDataTable[]) {
        const mod = await import("@/core/lib/user-deletion");
        return mod.modulePurgeTargets(tables);
    }

    it("purges a table the module marked purge, and only on the column it named", async () => {
        await softDeleteUser("usr_1");

        for (const model of MODULE_PRIVATE_MODELS) {
            expect(deleteCalls.some((c) => c.model === model), model).toBe(true);
        }
        expect(deleteCalls.find((c) => c.model === "linkedAccount")!.where).toEqual({ userId: "usr_1" });
        expect(deleteCalls.find((c) => c.model === "forumTopicLike")!.where).toEqual({ userId: "usr_1" });
    });

    it("keeps a table the module marked retain", async () => {
        await softDeleteUser("usr_1");

        // Orders and forum topics are the public record the design keeps;
        // they re-join the anonymised row.
        expect(deleteCalls.some((c) => c.model === "order")).toBe(false);
        expect(deleteCalls.some((c) => c.model === "forumTopic")).toBe(false);
    });

    it("keeps a table that says nothing, because retain is what every table did before", async () => {
        moduleTables = [{ model: "cartItem", key: "store.cart", column: "userId", module: "store" }];
        installedModels = new Set(["userSession", "cartItem"]);

        await softDeleteUser("usr_1");

        expect(deleteCalls.map((c) => c.model)).toEqual(["userSession"]);
    });

    it("purges a module core has never heard of", async () => {
        // The point of the registry: core named six tables belonging to five
        // modules in its own source, so a sixth module's private data could
        // not be erased at all without editing core.
        moduleTables = [
            { model: "kudosVote", key: "kudos.votes", column: "voterId", erasure: "purge", module: "kudos" },
        ];
        installedModels = new Set(["userSession", "kudosVote"]);

        await softDeleteUser("usr_1");

        expect(deleteCalls.find((c) => c.model === "kudosVote")!.where).toEqual({ voterId: "usr_1" });
    });

    it("deletes a table declared under two keys only once", async () => {
        const targets = await purgeTargets([
            { model: "chestItem", key: "store.chest", column: "userId", erasure: "purge", module: "store" },
            { model: "chestItem", key: "store.chestItems", column: "userId", erasure: "purge", module: "store" },
        ]);
        expect(targets).toEqual([{ model: "chestItem", column: "userId" }]);
    });

    it("keeps two columns of one table apart", async () => {
        const targets = await purgeTargets([
            { model: "referral", key: "referral.made", column: "referrerId", erasure: "purge", module: "referral" },
            { model: "referral", key: "referral.taken", column: "referredId", erasure: "purge", module: "referral" },
        ]);
        expect(targets).toHaveLength(2);
    });

    it("reads nothing but purge out of the registry", async () => {
        const targets = await purgeTargets([
            { model: "a", key: "a", column: "userId", erasure: "purge", module: "m" },
            { model: "b", key: "b", column: "userId", erasure: "retain", module: "m" },
            { model: "c", key: "c", column: "userId", module: "m" },
            { model: "d", key: "d", column: "userId", erasure: "PURGE", module: "m" },
        ]);
        expect(targets.map((t) => t.model)).toEqual(["a"]);
    });
});

describe("softDeleteUser", () => {
    it("purges every private model on the user's own column", async () => {
        const result = await softDeleteUser("usr_1");

        expect(result).toEqual({ success: true });
        expect(deleteCalls.map((c) => c.model)).toEqual(ALL_PRIVATE_MODELS);
        // `message` joins through authorId, not userId - a copy/paste of the
        // wrong column would delete nothing and leave DMs behind.
        expect(deleteCalls.find((c) => c.model === "message")!.where).toEqual({ authorId: "usr_1" });
        expect(deleteCalls.find((c) => c.model === "userSession")!.where).toEqual({ userId: "usr_1" });
    });

    it("leaves the public record and moderation history intact", async () => {
        await softDeleteUser("usr_1");

        // Deleting these would take out other people's threads and the
        // evidence behind bans. The join now resolves to the anonymised row.
        for (const model of PUBLIC_RECORD_MODELS) {
            expect(deleteCalls.some((c) => c.model === model)).toBe(false);
        }
    });

    it("anonymises the user row in place rather than deleting it", async () => {
        await softDeleteUser("usr_1", "spam");

        expect(updateArgs!.where).toEqual({ id: "usr_1" });
        expect(updateArgs!.data).toMatchObject({
            email: "deleted-usr_1@anonymous.local",
            username: "deleted-user-usr_1",
            avatar: null,
            password: "",
            isDeleted: true,
            banReason: "spam",
        });
        expect(updateArgs!.data.deletedAt).toBeInstanceOf(Date);
    });

    it("derives an email and username that keep the unique constraints satisfied", async () => {
        await softDeleteUser("cuid_aaaaaaaaaaaaaaaa");
        const first = updateArgs!.data;

        deleteCalls.length = 0;
        userRow = { id: "cuid_bbbbbbbbbbbbbbbb", isDeleted: false };
        await softDeleteUser("cuid_bbbbbbbbbbbbbbbb");

        // Two erasures must not collide on User.email / User.username; the
        // second would fail and leave a half-purged account behind.
        expect(updateArgs!.data.email).not.toBe(first.email);
        expect(updateArgs!.data.username).not.toBe(first.username);
        expect(updateArgs!.data.username).toBe("deleted-user-cuid_bbb");
    });

    it("stores no ban reason when none was given", async () => {
        await softDeleteUser("usr_1");
        expect(updateArgs!.data.banReason).toBeNull();
    });

    it("purges before anonymising", async () => {
        await softDeleteUser("usr_1");

        // If anonymisation went first and then something threw, the account
        // would already be unreachable while its private data was still
        // there - the worst of both outcomes.
        const writes = opLog.filter((op) => !op.startsWith("hook:"));
        expect(writes[writes.length - 1]).toBe("update:user");
        expect(writes.slice(0, -1).every((op) => op.startsWith("delete:"))).toBe(true);
    });

    it("tells the modules once the account is actually anonymised", async () => {
        // A module keeps data core cannot reach - a column it added to User,
        // a cache, a file. This action is its only notice, and it must come
        // after the row has changed rather than before.
        await softDeleteUser("usr_1", "spam");

        expect(firedHooks).toEqual([{ name: "user.deleted", payload: { userId: "usr_1", reason: "spam" } }]);
        expect(opLog[opLog.length - 1]).toBe("hook:user.deleted");
        expect(opLog[opLog.length - 2]).toBe("update:user");
    });

    it("passes a null reason rather than undefined", async () => {
        await softDeleteUser("usr_1");
        expect(firedHooks[0].payload).toEqual({ userId: "usr_1", reason: null });
    });

    it("reports success even when a listener throws", async () => {
        hookThrows = true;

        // The erasure has already happened by then. Reporting it as failed
        // would invite a retry, and the second run is refused as "already
        // deleted" - so the caller would be told an erasure failed that did
        // not, and could never be made to succeed.
        expect(await softDeleteUser("usr_1")).toEqual({ success: true });
        expect(updateArgs).not.toBeNull();
    });

    it("fires nothing when the erasure was refused", async () => {
        userRow = { id: "usr_1", isDeleted: true };
        await softDeleteUser("usr_1");
        expect(firedHooks).toEqual([]);
    });

    it("refuses to erase the only administrator who can still sign in", async () => {
        // The setup wizard creates one administrator, so on a fresh install
        // this account is the only way into the admin panel. Both delete
        // paths - an administrator removing somebody and somebody removing
        // themselves from the profile screen - land here, which is why the
        // check lives on this side rather than in either route.
        userRow = { id: "usr_1", isDeleted: false, isBanned: false, role: { name: "admin" } };
        usableAdmins = 1;

        const result = await softDeleteUser("usr_1");

        expect(result.success).toBe(false);
        expect(result.refused).toBe(true);
        expect(result.error).toMatch(/only administrator/i);
        // Nothing was purged and nothing was written: a refusal that had
        // already deleted half the account would be the worst of both.
        expect(deleteCalls).toHaveLength(0);
        expect(updateArgs).toBeNull();
    });

    it("erases an administrator once somebody else can still get in", async () => {
        userRow = { id: "usr_1", isDeleted: false, isBanned: false, role: { name: "admin" } };
        usableAdmins = 2;

        expect((await softDeleteUser("usr_1")).success).toBe(true);
        expect(updateArgs).not.toBeNull();
    });

    it("refuses an unknown user without touching anything", async () => {
        userRow = null;

        expect(await softDeleteUser("nope")).toEqual({
            success: false,
            error: "User not found",
            // A decision this made and explained, not a server that broke:
            // both callers used to answer every failure with a 500.
            refused: true,
        });
        expect(deleteCalls).toHaveLength(0);
        expect(updateArgs).toBeNull();
    });

    it("is idempotent: a second erasure is refused, not re-run", async () => {
        userRow = { id: "usr_1", isDeleted: true };

        expect(await softDeleteUser("usr_1")).toEqual({
            success: false,
            error: "User already deleted",
            // A decision this made and explained, not a server that broke:
            // both callers used to answer every failure with a 500.
            refused: true,
        });
        // Re-running would rewrite deletedAt and lose the original erasure
        // timestamp, which is the one thing a regulator asks for.
        expect(updateArgs).toBeNull();
        expect(deleteCalls).toHaveLength(0);
    });

    it("skips models the installed modules do not provide", async () => {
        installedModels = new Set(["userSession", "account"]);

        expect(await softDeleteUser("usr_1")).toEqual({ success: true });
        expect(deleteCalls.map((c) => c.model)).toEqual(["userSession", "account"]);
        expect(updateArgs).not.toBeNull();
    });

    it("skips a client property that exists but has no deleteMany", async () => {
        installedModels = new Set(["userSession"]);
        // The Prisma client carries non-model properties ($extends, $connect)
        // alongside the delegates; a name collision must not be called.
        bogusModels = new Set(["notification", "apiKey"]);

        expect(await softDeleteUser("usr_1")).toEqual({ success: true });
        expect(deleteCalls.map((c) => c.model)).toEqual(["userSession"]);
        expect(updateArgs).not.toBeNull();
    });

    it("continues past a delegate whose delete fails", async () => {
        failingModels = new Set(["notification", "cartItem"]);

        expect(await softDeleteUser("usr_1")).toEqual({ success: true });
        // The two failures must not cost us the eleven that would succeed,
        // nor the anonymisation that is the point of the operation.
        expect(deleteCalls).toHaveLength(ALL_PRIVATE_MODELS.length - 2);
        expect(updateArgs).not.toBeNull();
    });

    it("reports the error when the anonymising update fails", async () => {
        updateThrows = new Error("unique constraint violated");

        expect(await softDeleteUser("usr_1")).toEqual({
            success: false,
            error: "unique constraint violated",
        });
    });

    it("reports a lookup failure rather than throwing", async () => {
        findThrows = new Error("connection refused");

        expect(await softDeleteUser("usr_1")).toEqual({
            success: false,
            error: "connection refused",
        });
        expect(deleteCalls).toHaveLength(0);
    });

    it("survives a thrown non-Error", async () => {
        updateThrows = "just a string";

        expect(await softDeleteUser("usr_1")).toEqual({
            success: false,
            error: "Unknown error",
        });
    });
});
