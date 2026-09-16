// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A role that was given for a while, and what happens when the while is up.
 *
 * This used to be the hardest thing in the role system, because a member held
 * exactly one role: handing one out for thirty days meant remembering what
 * they held before and putting it back, and the sweep could be wrong in two
 * directions that cost opposite things - leave somebody a rank they stopped
 * paying for, or silently undo an operator's own promotion months later.
 *
 * A set has neither problem. The lapsed row goes and the rest of the set is
 * untouched, so there is nothing to put back and nothing to guess. What is
 * left to defend is that the sweep removes only what expired, that it leaves
 * the displayed role true afterwards, and that an account deleted between the
 * read and the write does not abandon the rest of the sweep.
 */

const mockUserRoleFindMany = vi.fn();
const mockUserRoleDeleteMany = vi.fn();
const mockSync = vi.fn();

vi.mock("@/core/lib/db", () => ({
    prisma: {
        userRole: {
            findMany: (...args: unknown[]) => mockUserRoleFindMany(...args),
            deleteMany: (...args: unknown[]) => mockUserRoleDeleteMany(...args),
        },
    },
}));
vi.mock("@/core/lib/roles", () => ({ syncDisplayedRole: (...args: unknown[]) => mockSync(...args) }));
vi.mock("@/core/lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { sweepLapsedRoles } = await import("@/core/lib/timed-roles");

beforeEach(() => {
    vi.clearAllMocks();
    mockUserRoleDeleteMany.mockResolvedValue({ count: 0 });
    mockSync.mockResolvedValue(null);
});

describe("the sweep", () => {
    it("does nothing when nothing has lapsed", async () => {
        mockUserRoleFindMany.mockResolvedValue([]);
        expect(await sweepLapsedRoles()).toBe(0);
        expect(mockUserRoleDeleteMany).not.toHaveBeenCalled();
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("takes back only the rows whose time is up", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            { id: "g1", userId: "u1", roleId: "gold" },
            { id: "g2", userId: "u2", roleId: "silver" },
        ]);
        mockUserRoleDeleteMany.mockResolvedValue({ count: 2 });

        expect(await sweepLapsedRoles()).toBe(2);
        expect(mockUserRoleDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["g1", "g2"] } } });
    });

    it("leaves the badge true for every member it touched", async () => {
        mockUserRoleFindMany.mockResolvedValue([
            { id: "g1", userId: "u1", roleId: "gold" },
            { id: "g2", userId: "u1", roleId: "silver" },
            { id: "g3", userId: "u2", roleId: "gold" },
        ]);
        mockUserRoleDeleteMany.mockResolvedValue({ count: 3 });

        await sweepLapsedRoles();

        // Once per member, not once per row: two lapsed ranks for one member
        // is one badge to recompute.
        expect(mockSync).toHaveBeenCalledTimes(2);
        expect(mockSync).toHaveBeenCalledWith("u1");
        expect(mockSync).toHaveBeenCalledWith("u2");
    });

    it("finishes the sweep when one member cannot be brought up to date", async () => {
        // The account was deleted between the read and the write. The rest of
        // the sweep is not somebody else's problem to inherit.
        mockUserRoleFindMany.mockResolvedValue([
            { id: "g1", userId: "gone", roleId: "gold" },
            { id: "g2", userId: "u2", roleId: "gold" },
        ]);
        mockUserRoleDeleteMany.mockResolvedValue({ count: 2 });
        mockSync.mockImplementation(async (userId: string) => {
            if (userId === "gone") throw new Error("no such user");
            return null;
        });

        expect(await sweepLapsedRoles()).toBe(2);
        expect(mockSync).toHaveBeenCalledWith("u2");
    });

    it("asks only for rows that have expired", async () => {
        const now = new Date("2026-09-16T12:00:00Z");
        mockUserRoleFindMany.mockResolvedValue([]);
        await sweepLapsedRoles(now);
        expect(mockUserRoleFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { expiresAt: { lte: now } } }),
        );
    });
});
