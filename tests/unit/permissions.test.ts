// @vitest-environment node
/**
 * Unit tests for src/core/lib/permissions.ts - the authorization gate for the
 * entire admin surface. Tested as a REAL subject (the functions run unmodified);
 * only the Prisma client is mocked, the same way api-key-auth.test.ts does it.
 *
 * Coverage:
 *   - hasPermission: role has perm / lacks perm / admin wildcard bypass /
 *     no user / no role
 *   - hasAnyPermission / hasAllPermissions: positive, negative, admin bypass
 *   - getUserPermissions: aggregation + admin "*" + empty when no role
 *   - hasResourcePermission: admin bypass, no-grants deny, most-specific-wins
 *     precedence (user+id > user > role+id > role), deny short-circuit, wildcard
 *     action match
 *   - isAdmin / isStaff: sessionRole fast path, sessionPriority fast path,
 *     DB fallback, and that a role name alone never confers staff
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma - only the methods permissions.ts touches.
const mockUserFindUnique = vi.fn();
const mockUserRoleFindMany = vi.fn();
const mockResourceFindMany = vi.fn();

vi.mock("@/core/lib/db", () => ({
    prisma: {
        userRole: {
            findMany: (...args: unknown[]) => mockUserRoleFindMany(...args),
        },
        user: {
            findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
        },
        resourcePermission: {
            findMany: (...args: unknown[]) => mockResourceFindMany(...args),
        },
    },
}));

import {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    getUserPermissions,
    hasResourcePermission,
    effectivePermissions,
    requirePermission,
    isAdmin,
    isStaff,
} from "@/core/lib/permissions";

// Helpers to build the held-role rows the resolver reads. A member holds a
// set now, so each of these is a set with one role in it; the union itself is
// covered in `roles-combine-by-union`.
function memberWith(perms: string[], opts: { priority?: number; roleId?: string } = {}) {
    return [
        {
            roleId: opts.roleId ?? "role-member",
            expiresAt: null,
            role: {
                name: "member",
                priority: opts.priority ?? 0,
                rolePermissions: perms.map((name) => ({ permission: name, state: "ALLOW" as const })),
            },
        },
    ];
}

function adminUser() {
    return [
        {
            roleId: "role-admin",
            expiresAt: null,
            role: { name: "admin", priority: 100, rolePermissions: [] },
        },
    ];
}

/** A member who holds nothing: the row set is empty, whatever the reason. */
function holdsNothing() {
    return [];
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("hasPermission", () => {
    it("returns true when the role carries the permission", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith(["blog.manage", "store.view"]));
        expect(await hasPermission("u1", "blog.manage")).toBe(true);
    });

    it("returns false when the role lacks the permission", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith(["store.view"]));
        expect(await hasPermission("u1", "blog.manage")).toBe(false);
    });

    it("admin role bypasses the permission list entirely", async () => {
        mockUserRoleFindMany.mockResolvedValue(adminUser());
        expect(await hasPermission("admin1", "anything.at.all")).toBe(true);
    });

    it("returns false when the user does not exist", async () => {
        mockUserRoleFindMany.mockResolvedValue(holdsNothing());
        expect(await hasPermission("ghost", "blog.manage")).toBe(false);
    });

    it("returns false when the user has no role", async () => {
        mockUserRoleFindMany.mockResolvedValue(holdsNothing());
        expect(await hasPermission("u1", "blog.manage")).toBe(false);
    });
});

describe("hasAnyPermission", () => {
    it("true when at least one listed permission is held", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith(["store.view"]));
        expect(await hasAnyPermission("u1", ["blog.manage", "store.view"])).toBe(true);
    });

    it("false when none of the listed permissions are held", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith(["forum.post"]));
        expect(await hasAnyPermission("u1", ["blog.manage", "store.view"])).toBe(false);
    });

    it("admin bypasses", async () => {
        mockUserRoleFindMany.mockResolvedValue(adminUser());
        expect(await hasAnyPermission("admin1", ["nope.one", "nope.two"])).toBe(true);
    });

    it("false when no role", async () => {
        mockUserRoleFindMany.mockResolvedValue(holdsNothing());
        expect(await hasAnyPermission("u1", ["blog.manage"])).toBe(false);
    });
});

describe("hasAllPermissions", () => {
    it("true only when every listed permission is held", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith(["a.x", "b.y", "c.z"]));
        expect(await hasAllPermissions("u1", ["a.x", "b.y"])).toBe(true);
    });

    it("false when one of the listed permissions is missing", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith(["a.x"]));
        expect(await hasAllPermissions("u1", ["a.x", "b.y"])).toBe(false);
    });

    it("admin bypasses", async () => {
        mockUserRoleFindMany.mockResolvedValue(adminUser());
        expect(await hasAllPermissions("admin1", ["a.x", "b.y", "c.z"])).toBe(true);
    });

    it("false when no user", async () => {
        mockUserRoleFindMany.mockResolvedValue(holdsNothing());
        expect(await hasAllPermissions("u1", ["a.x"])).toBe(false);
    });
});

describe("getUserPermissions", () => {
    it("aggregates the role's permission names", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith(["blog.manage", "store.view"]));
        const perms = await getUserPermissions("u1");
        expect(perms).toEqual(["blog.manage", "store.view"]);
    });

    it("returns ['*'] for admin", async () => {
        mockUserRoleFindMany.mockResolvedValue(adminUser());
        expect(await getUserPermissions("admin1")).toEqual(["*"]);
    });

    it("returns [] when user has no role", async () => {
        mockUserRoleFindMany.mockResolvedValue(holdsNothing());
        expect(await getUserPermissions("u1")).toEqual([]);
    });

    it("returns [] when user is missing", async () => {
        mockUserRoleFindMany.mockResolvedValue(holdsNothing());
        expect(await getUserPermissions("ghost")).toEqual([]);
    });
});

describe("effectivePermissions", () => {
    it("is the set a caller can ask about without a second query", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith(["blog.manage", "store.view"]));
        expect(await effectivePermissions("u1")).toEqual(new Set(["blog.manage", "store.view"]));
    });

    it("is empty for an administrator, who bypasses rather than holds names", async () => {
        mockUserRoleFindMany.mockResolvedValue(adminUser());
        expect(await effectivePermissions("u1")).toEqual(new Set());
    });
});

describe("two roles that disagree about one entity", () => {
    it("refuses, because a second role must not lift a refusal written against the first", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            { roleId: "role-a", expiresAt: null, role: { name: "editor", priority: 10, rolePermissions: [] } },
            { roleId: "role-b", expiresAt: null, role: { name: "muted", priority: 5, rolePermissions: [] } },
        ]);
        mockResourceFindMany.mockResolvedValue([
            { principalType: "role", principalId: "role-a", resourceId: null, action: "edit", allow: true },
            { principalType: "role", principalId: "role-b", resourceId: null, action: "edit", allow: false },
        ]);

        expect(await hasResourcePermission("u1", "blog.article", "edit")).toBe(false);
    });

    it("allows when both of them say so", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            { roleId: "role-a", expiresAt: null, role: { name: "editor", priority: 10, rolePermissions: [] } },
            { roleId: "role-b", expiresAt: null, role: { name: "writer", priority: 5, rolePermissions: [] } },
        ]);
        mockResourceFindMany.mockResolvedValue([
            { principalType: "role", principalId: "role-a", resourceId: null, action: "edit", allow: true },
            { principalType: "role", principalId: "role-b", resourceId: null, action: "*", allow: true },
        ]);

        expect(await hasResourcePermission("u1", "blog.article", "edit")).toBe(true);
    });
});

describe("requirePermission", () => {
    it("lets a caller through when they hold the name", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith(["blog.manage"]));
        expect(await requirePermission("blog.manage")("u1")).toEqual({ allowed: true });
    });

    it("refuses, and says which name was missing", async () => {
        // The message names the permission because the caller is a route
        // handler writing a log line, not a person reading a screen: a
        // refusal that does not say what was refused is a support ticket.
        mockUserRoleFindMany.mockResolvedValue(memberWith(["store.view"]));
        const answer = await requirePermission("blog.manage")("u1");
        expect(answer.allowed).toBe(false);
        expect(answer.error).toContain("blog.manage");
    });

    it("lets an administrator through whatever the name is", async () => {
        mockUserRoleFindMany.mockResolvedValue(adminUser());
        expect(await requirePermission("anything.at-all")("u1")).toEqual({ allowed: true });
    });
});

describe("hasResourcePermission", () => {
    it("admin bypasses without touching grants", async () => {
        mockUserRoleFindMany.mockResolvedValue(adminUser());
        expect(await hasResourcePermission("admin1", "blog.article", "edit", "art-1")).toBe(true);
        expect(mockResourceFindMany).not.toHaveBeenCalled();
    });

    it("denies when no grants exist at all", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith([], { roleId: "role-member" }));
        mockResourceFindMany.mockResolvedValue([]);
        expect(await hasResourcePermission("u1", "blog.article", "edit")).toBe(false);
    });

    it("denies when user/role has no role", async () => {
        mockUserRoleFindMany.mockResolvedValue(holdsNothing());
        expect(await hasResourcePermission("u1", "blog.article", "edit")).toBe(false);
        expect(mockResourceFindMany).not.toHaveBeenCalled();
    });

    it("allows via a role-wide grant", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith([], { roleId: "role-member" }));
        mockResourceFindMany.mockResolvedValue([
            { principalType: "role", principalId: "role-member", resourceId: null, action: "edit", allow: true },
        ]);
        expect(await hasResourcePermission("u1", "blog.article", "edit")).toBe(true);
    });

    it("most-specific-wins: user+resourceId allow beats a role-wide deny", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith([], { roleId: "role-member" }));
        mockResourceFindMany.mockResolvedValue([
            { principalType: "role", principalId: "role-member", resourceId: null, action: "edit", allow: false },
            { principalType: "user", principalId: "u1", resourceId: "art-7", action: "edit", allow: true },
        ]);
        expect(await hasResourcePermission("u1", "blog.article", "edit", "art-7")).toBe(true);
    });

    it("most-specific-wins: a user+resourceId deny short-circuits over a broader user allow", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith([], { roleId: "role-member" }));
        mockResourceFindMany.mockResolvedValue([
            { principalType: "user", principalId: "u1", resourceId: null, action: "edit", allow: true },
            { principalType: "user", principalId: "u1", resourceId: "art-7", action: "edit", allow: false },
        ]);
        expect(await hasResourcePermission("u1", "blog.article", "edit", "art-7")).toBe(false);
    });

    it("falls back to role-wide when no user-level or resource-scoped grant matches", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith([], { roleId: "role-member" }));
        mockResourceFindMany.mockResolvedValue([
            { principalType: "role", principalId: "role-member", resourceId: null, action: "view", allow: true },
        ]);
        // resourceId supplied but only a role-wide grant exists -> still allows.
        expect(await hasResourcePermission("u1", "blog.article", "view", "art-9")).toBe(true);
    });


    /**
     * An exact action and a wildcard can sit on the same principal at the same
     * level: the unique key is (resource, resourceId, action, principalType,
     * principalId), so "edit" and "*" are two rows, not one.
     *
     * The query asks for both and the resolution loop matched on principal and
     * resourceId alone, so whichever row the database handed back first won.
     * An operator who grants a role everything and then takes one action away
     * had written a deny that held or did not hold depending on row order.
     *
     * Most specific wins, and an action names itself where "*" does not.
     */
    it("lets a deny on the action itself beat a wildcard allow beside it", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith([], { roleId: "role-member" }));
        mockResourceFindMany.mockResolvedValue([
            { principalType: "role", principalId: "role-member", resourceId: null, action: "*", allow: true },
            { principalType: "role", principalId: "role-member", resourceId: null, action: "edit", allow: false },
        ]);
        expect(await hasResourcePermission("u1", "blog.article", "edit")).toBe(false);
    });

    it("answers the same whichever way round the two rows arrive", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith([], { roleId: "role-member" }));
        mockResourceFindMany.mockResolvedValue([
            { principalType: "role", principalId: "role-member", resourceId: null, action: "edit", allow: false },
            { principalType: "role", principalId: "role-member", resourceId: null, action: "*", allow: true },
        ]);
        expect(await hasResourcePermission("u1", "blog.article", "edit")).toBe(false);
    });

    it("lets an allow on the action itself beat a wildcard deny beside it", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith([], { roleId: "role-member" }));
        mockResourceFindMany.mockResolvedValue([
            { principalType: "role", principalId: "role-member", resourceId: null, action: "*", allow: false },
            { principalType: "role", principalId: "role-member", resourceId: null, action: "view", allow: true },
        ]);
        expect(await hasResourcePermission("u1", "blog.article", "view")).toBe(true);
    });

    it("a wildcard-action grant (action '*') satisfies a specific action request", async () => {
        mockUserRoleFindMany.mockResolvedValue(memberWith([], { roleId: "role-member" }));
        // The route asks findMany for action in [action, "*"]; a "*" grant comes
        // back and matches the candidate resolution. The row carried no action at
        // all until the resolution started reading one, so this asserted the
        // wildcard path without ever putting a wildcard in front of it.
        mockResourceFindMany.mockResolvedValue([
            { principalType: "user", principalId: "u1", resourceId: null, action: "*", allow: true },
        ]);
        expect(await hasResourcePermission("u1", "blog.article", "delete")).toBe(true);
        // Confirm the query asked for both the action and the wildcard.
        const whereArg = mockResourceFindMany.mock.calls[0][0].where;
        expect(whereArg.action).toEqual({ in: ["delete", "*"] });
    });
});

describe("isAdmin", () => {
    it("sessionRole=admin short-circuits without a DB hit", async () => {
        expect(await isAdmin("u1", "admin")).toBe(true);
        expect(mockUserFindUnique).not.toHaveBeenCalled();
    });

    it("falls back to DB and returns true for an admin role", async () => {
        mockUserRoleFindMany.mockResolvedValue([{ roleId: "role-admin", expiresAt: null, role: { name: "admin", priority: 0, rolePermissions: [] } }]);
        expect(await isAdmin("u1")).toBe(true);
    });

    it("returns false for a non-admin role via DB", async () => {
        mockUserRoleFindMany.mockResolvedValue([{ roleId: "role-member", expiresAt: null, role: { name: "member", priority: 0, rolePermissions: [] } }]);
        expect(await isAdmin("u1")).toBe(false);
    });

    it("returns false when user is missing", async () => {
        mockUserRoleFindMany.mockResolvedValue(holdsNothing());
        expect(await isAdmin("ghost")).toBe(false);
    });
});

describe("isStaff", () => {
    it("sessionRole=admin short-circuits true", async () => {
        expect(await isStaff("u1", "admin")).toBe(true);
        expect(mockUserFindUnique).not.toHaveBeenCalled();
    });

    it("a role named moderator is not staff by its name alone", async () => {
        // It used to short-circuit true on the name. Demoting that role in the
        // admin panel hid the staff links and left the endpoints open.
        mockUserRoleFindMany.mockResolvedValue([{ roleId: "role-x", expiresAt: null, role: { name: "invented", priority: 10, rolePermissions: [] } }]);
        expect(await isStaff("u1", "moderator")).toBe(false);
    });

    it("sessionPriority short-circuits, in both directions", async () => {
        expect(await isStaff("u1", "moderator", 60)).toBe(true);
        expect(await isStaff("u1", "moderator", 10)).toBe(false);
        expect(mockUserFindUnique).not.toHaveBeenCalled();
    });

    it("a role the site invented is staff when it ranks high enough", async () => {
        mockUserRoleFindMany.mockResolvedValue([{ roleId: "role-x", expiresAt: null, role: { name: "invented", priority: 70, rolePermissions: [] } }]);
        expect(await isStaff("u1", "developer")).toBe(true);
    });

    it("DB fallback: priority >= 50 is staff", async () => {
        mockUserRoleFindMany.mockResolvedValue([{ roleId: "role-x", expiresAt: null, role: { name: "invented", priority: 50, rolePermissions: [] } }]);
        expect(await isStaff("u1")).toBe(true);
    });

    it("DB fallback: priority < 50 is not staff", async () => {
        mockUserRoleFindMany.mockResolvedValue([{ roleId: "role-x", expiresAt: null, role: { name: "invented", priority: 10, rolePermissions: [] } }]);
        expect(await isStaff("u1")).toBe(false);
    });

    it("returns false when user has no role", async () => {
        mockUserRoleFindMany.mockResolvedValue(holdsNothing());
        expect(await isStaff("u1")).toBe(false);
    });
});
