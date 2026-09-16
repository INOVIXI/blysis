// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A member holds a set of roles, and what they may do is the union of it.
 *
 * Roles only ever grant. Two of them cannot disagree, so nothing has to
 * arbitrate between them and "which role wins" is a question this shape
 * refuses to create - the only refusal is an exception written against one
 * member or one role, deliberately.
 *
 * The shape this replaces held exactly one role per member, which is why
 * handing out a rank had to remember what to put back. Somebody who was a
 * moderator and then bought a rank stopped being a moderator for a month. The
 * two facts are independent and are two rows now.
 *
 * A row may carry a time. An expired one grants nothing from the moment it
 * expires, without waiting for the sweep that deletes it: a permission that
 * outlives its expiry until a cron happens to run is not an expiry.
 */

const mockUserRoleFindMany = vi.fn();
const mockUserFindUnique = vi.fn();
const mockResourceFindMany = vi.fn();

vi.mock("@/core/lib/db", () => ({
    prisma: {
        userRole: { findMany: (...args: unknown[]) => mockUserRoleFindMany(...args) },
        user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
        resourcePermission: { findMany: (...args: unknown[]) => mockResourceFindMany(...args) },
    },
}));

const { hasPermission, hasAnyPermission, getUserPermissions, isAdmin, isStaff, effectivePermissions } =
    await import("@/core/lib/permissions");

/** One held role, as the resolver reads it. */
function held(name: string, priority: number, permissions: string[], expiresAt: Date | null = null) {
    return { expiresAt, role: { name, priority, permissions: permissions.map((p) => ({ name: p })) } };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockResourceFindMany.mockResolvedValue([]);
});

describe("a member with two roles", () => {
    it("may do what either of them allows", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            held("moderator", 50, ["admin.moderation"]),
            held("editor", 30, ["admin.content"]),
        ]);

        expect(await hasPermission("u1", "admin.moderation")).toBe(true);
        expect(await hasPermission("u1", "admin.content")).toBe(true);
        expect(await hasPermission("u1", "admin.settings")).toBe(false);
    });

    it("does not lose one role's permission by holding another", async () => {
        // The failure this replaces: buying a rank overwrote the single role
        // column, so a moderator who bought one stopped moderating.
        mockUserRoleFindMany.mockResolvedValue([
            held("moderator", 50, ["admin.moderation"]),
            held("gold", 10, [], new Date(Date.now() + 86_400_000)),
        ]);

        expect(await hasPermission("u1", "admin.moderation")).toBe(true);
    });

    it("reports the union, without repeating a name both roles carry", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            held("moderator", 50, ["admin.moderation", "admin.users"]),
            held("support", 40, ["admin.users", "admin.messaging"]),
        ]);

        expect((await getUserPermissions("u1")).sort()).toEqual([
            "admin.messaging",
            "admin.moderation",
            "admin.users",
        ]);
    });

    it("answers any-of against the whole set", async () => {
        mockUserRoleFindMany.mockResolvedValue([held("editor", 30, ["admin.content"])]);
        expect(await hasAnyPermission("u1", ["admin.settings", "admin.content"])).toBe(true);
        expect(await hasAnyPermission("u1", ["admin.settings", "admin.backups"])).toBe(false);
    });
});

describe("a role that has expired", () => {
    it("grants nothing from the moment it expired, not from the sweep", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            held("gold", 10, ["store.manage"], new Date(Date.now() - 1_000)),
        ]);

        expect(await hasPermission("u1", "store.manage")).toBe(false);
        expect(await getUserPermissions("u1")).toEqual([]);
    });

    it("leaves the rest of the set alone", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            held("moderator", 50, ["admin.moderation"]),
            held("gold", 10, ["store.manage"], new Date(Date.now() - 1_000)),
        ]);

        expect(await hasPermission("u1", "admin.moderation")).toBe(true);
        expect(await hasPermission("u1", "store.manage")).toBe(false);
    });
});

describe("who is an administrator, and who is staff", () => {
    it("is an administrator if any held role is the admin one", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            held("member", 0, []),
            held("admin", 100, []),
        ]);
        expect(await isAdmin("u1")).toBe(true);
    });

    it("grants an administrator everything without consulting a list", async () => {
        mockUserRoleFindMany.mockResolvedValue([held("admin", 100, [])]);
        expect(await hasPermission("u1", "anything.at-all")).toBe(true);
        expect(await getUserPermissions("u1")).toEqual(["*"]);
    });

    it("is staff at the highest priority held, not the first row", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            held("member", 0, []),
            held("moderator", 60, []),
        ]);
        expect(await isStaff("u1")).toBe(true);
    });

    it("is neither when every role is ordinary", async () => {
        mockUserRoleFindMany.mockResolvedValue([held("member", 0, [])]);
        expect(await isAdmin("u1")).toBe(false);
        expect(await isStaff("u1")).toBe(false);
    });

    it("is neither when the member holds no role at all", async () => {
        mockUserRoleFindMany.mockResolvedValue([]);
        expect(await isAdmin("u1")).toBe(false);
        expect(await isStaff("u1")).toBe(false);
        expect(await effectivePermissions("u1")).toEqual(new Set());
    });
});
