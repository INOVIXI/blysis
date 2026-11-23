import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * An admin acting as a member cannot remove that member's sign-in methods.
 *
 * Connecting was already refused while an admin acts as somebody else; taking
 * a method away was not. The member lost a way into their own account, and
 * the activity log recorded it as `user.sign_in_method.disconnect` by the
 * member, so nothing on the screen said an admin had done it.
 */

let session: { user: { id: string; role: string; originalUserId?: string } } | null = null;
const disconnect = vi.fn(async () => ({ ok: true as const, providerAccountId: "p-1" }));
const logged = vi.fn(async () => undefined);

vi.mock("@/core/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/core/lib/rate-limit", () => ({ rateLimitForRoleAsync: async () => true }));
vi.mock("@/core/lib/sign-in-methods", () => ({ disconnectSignInMethod: disconnect }));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: logged }));

const { DELETE } = await import("@/app/api/v1/auth/sign-in-methods/[provider]/route");

function remove(provider = "discord") {
    return DELETE(new Request(`http://localhost/api/v1/auth/sign-in-methods/${provider}`, { method: "DELETE" }) as never, {
        params: Promise.resolve({ provider }),
    });
}

beforeEach(() => {
    disconnect.mockClear();
    logged.mockClear();
});

describe("removing a sign-in method", () => {
    it("is refused while an admin acts as the member, and nothing is removed", async () => {
        session = { user: { id: "member-1", role: "member", originalUserId: "admin-1" } };
        const res = await remove();
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe("impersonating");
        expect(disconnect).not.toHaveBeenCalled();
        expect(logged).not.toHaveBeenCalled();
    });

    it("still works for the member themselves", async () => {
        session = { user: { id: "member-1", role: "member" } };
        const res = await remove();
        expect(res.status).toBe(200);
        expect(disconnect).toHaveBeenCalledWith("member-1", "discord");
    });
});
