// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A member holds a set of roles, and what they may do is the union of it.
 *
 * A role says one of three things about a permission: yes, never, or nothing
 * at all. Yes from any held role allows it. **Never from any held role refuses
 * it, whatever any other role says**, which is what makes a restricted group
 * possible: "muted" takes posting away from somebody whose other roles grant
 * it, without editing those roles. Nothing at all is not a yes.
 *
 * Without the third state an operator can only build up, never take away, and
 * the only way to restrict one person is to unpick every role they hold.
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

/** One held role, as the resolver reads it. Strings are plain grants. */
function held(
    name: string,
    priority: number,
    permissions: (string | { permission: string; state: "ALLOW" | "NEVER" })[],
    expiresAt: Date | null = null,
) {
    return {
        roleId: `role-${name}`,
        expiresAt,
        role: {
            name,
            priority,
            rolePermissions: permissions.map((p) =>
                typeof p === "string" ? { permission: p, state: "ALLOW" as const } : p,
            ),
        },
    };
}

/** A role that takes a permission away from anybody holding it. */
function never(permission: string) {
    return { permission, state: "NEVER" as const };
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

describe("a role that says never", () => {
    it("takes the permission away from somebody whose other role grants it", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            held("moderator", 50, ["forum.manage"]),
            held("muted", 5, [never("forum.manage")]),
        ]);

        expect(await hasPermission("u1", "forum.manage")).toBe(false);
    });

    it("wins whichever order the rows come back in", async () => {
        // The database decides that order, and it must not decide this.
        mockUserRoleFindMany.mockResolvedValue([
            held("muted", 5, [never("forum.manage")]),
            held("moderator", 50, ["forum.manage"]),
        ]);

        expect(await hasPermission("u1", "forum.manage")).toBe(false);
    });

    it("does not outrank anything else the member may do", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            held("moderator", 50, ["forum.manage", "admin.moderation"]),
            held("muted", 5, [never("forum.manage")]),
        ]);

        expect(await hasPermission("u1", "admin.moderation")).toBe(true);
    });

    it("is not reported as something the member may do", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            held("moderator", 50, ["forum.manage", "admin.moderation"]),
            held("muted", 5, [never("forum.manage")]),
        ]);

        expect((await getUserPermissions("u1")).sort()).toEqual(["admin.moderation"]);
    });

    it("says nothing about a permission it does not name", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            held("moderator", 50, ["forum.manage"]),
            held("muted", 5, [never("store.manage")]),
        ]);

        expect(await hasPermission("u1", "forum.manage")).toBe(true);
    });

    it("stops counting once it has expired, like any other row", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            held("moderator", 50, ["forum.manage"]),
            held("muted", 5, [never("forum.manage")], new Date(Date.now() - 1_000)),
        ]);

        expect(await hasPermission("u1", "forum.manage")).toBe(true);
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
