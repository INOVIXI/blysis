// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The role shown beside a member's name is the highest one they hold.
 *
 * A member holds a set now, and a badge can only draw one. Picking it at
 * render time means a join per row - fifty rows on the members screen, fifty
 * joins - for a value that changes when somebody is promoted and at no other
 * time. So `User.roleId` keeps its column and becomes a cache of the top of
 * the set, and one function is allowed to write it.
 *
 * "Highest" is priority, which is the number the site already sorts and styles
 * roles by. Ties go to the one held longest, so a promotion changes the badge
 * and a second job at the same rank does not.
 *
 * An expired row is not worn. Somebody whose paid rank lapsed wears whatever
 * they hold permanently, the moment it lapses, rather than until a sweep runs.
 */

const mockUserRoleFindMany = vi.fn();
const mockUserUpdate = vi.fn();

vi.mock("@/core/lib/db", () => ({
    prisma: {
        userRole: { findMany: (...args: unknown[]) => mockUserRoleFindMany(...args) },
        user: { update: (...args: unknown[]) => mockUserUpdate(...args) },
    },
}));

const { topRole, syncDisplayedRole } = await import("@/core/lib/roles");

function held(roleId: string, priority: number, grantedAt: string, expiresAt: Date | null = null) {
    return { roleId, expiresAt, grantedAt: new Date(grantedAt), role: { priority } };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockUserUpdate.mockResolvedValue({});
});

describe("the role a member wears", () => {
    it("is the highest-priority one they hold", () => {
        expect(
            topRole([
                held("member", 0, "2026-01-01"),
                held("moderator", 60, "2026-02-01"),
                held("supporter", 10, "2026-03-01"),
            ]),
        ).toBe("moderator");
    });

    it("is the one held longest when two rank the same", () => {
        expect(
            topRole([
                held("support", 60, "2026-05-01"),
                held("moderator", 60, "2026-01-01"),
            ]),
        ).toBe("moderator");
    });

    it("ignores a role whose time is up", () => {
        expect(
            topRole([
                held("member", 0, "2026-01-01"),
                held("gold", 90, "2026-02-01", new Date(Date.now() - 1_000)),
            ]),
        ).toBe("member");
    });

    it("keeps a role whose time has not come yet", () => {
        expect(
            topRole([
                held("member", 0, "2026-01-01"),
                held("gold", 90, "2026-02-01", new Date(Date.now() + 86_400_000)),
            ]),
        ).toBe("gold");
    });

    it("is nothing when the member holds nothing", () => {
        expect(topRole([])).toBeNull();
    });
});

describe("keeping the cache true", () => {
    it("writes the top role onto the member", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            held("member", 0, "2026-01-01"),
            held("moderator", 60, "2026-02-01"),
        ]);

        await syncDisplayedRole("u1");

        expect(mockUserUpdate).toHaveBeenCalledWith({
            where: { id: "u1" },
            data: { roleId: "moderator" },
        });
    });

    it("clears it when the last role goes", async () => {
        mockUserRoleFindMany.mockResolvedValue([]);

        await syncDisplayedRole("u1");

        expect(mockUserUpdate).toHaveBeenCalledWith({
            where: { id: "u1" },
            data: { roleId: null },
        });
    });

    it("answers with what it wrote, so a caller need not read it back", async () => {
        mockUserRoleFindMany.mockResolvedValue([held("moderator", 60, "2026-02-01")]);
        expect(await syncDisplayedRole("u1")).toBe("moderator");
    });
});
