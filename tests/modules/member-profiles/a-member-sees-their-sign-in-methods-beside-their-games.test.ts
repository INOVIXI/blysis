/**
 * A member's own Linked accounts tab lists the sign-in methods they connected.
 *
 * A member connected Discord from the account page's Sign-in methods section
 * and the row was there, but Linked accounts showed nothing for it: the tab
 * listed only what a game module answered to `profile.linkedAccounts`, and
 * core, which owns sign-in methods, cannot listen to a module's hook. The
 * tab's endpoint asks core through the SDK now, for the member who is asking.
 *
 * The public profile reads `readMember`, which does not, so a stranger still
 * learns nothing about how somebody signs in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let session: { user: { id: string } } | null = null;

const signInMethodsOf = vi.fn(async (userId: string) => userId === "m1"
    ? [{
        provider: "discord",
        providerAccountId: "80351110224678912",
        displayName: "mavikaplan",
        connectedAt: new Date("2026-11-11T10:00:00Z"),
        // What a row would carry if a select ever widened: the endpoint
        // passes on what the tab draws and nothing else.
        access_token: "secret-access",
        refresh_token: "secret-refresh",
    }]
    : []);

const prisma = {
    user: {
        findFirst: async () => ({
            id: "m1",
            username: "Mavikaplan",
            avatar: null,
            createdAt: new Date("2026-03-04T12:00:00Z"),
            role: null,
        }),
    },
};

vi.mock("@/core/sdk/auth", () => ({ auth: async () => session }));
vi.mock("@/core/sdk/server", () => ({ prisma, signInMethodsOf }));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: async (_hook: string, initial: unknown) => initial }));
vi.mock("@/modules/member-profiles/lib/read-linked-accounts", () => ({
    readLinkedAccounts: async () => [{ provider: "minecraft", username: "Mavikaplan", avatar: null }],
}));

const { GET } = await import("@/modules/member-profiles/api/linked-accounts/route");
const { readMember } = await import("@/modules/member-profiles/lib/read-member");

beforeEach(() => {
    session = null;
    signInMethodsOf.mockClear();
});

describe("the member's own linked accounts", () => {
    it("are nobody's without a session", async () => {
        const res = await GET();
        expect(res.status).toBe(401);
        expect(signInMethodsOf).not.toHaveBeenCalled();
    });

    it("list the sign-in methods they connected beside the games that proved them", async () => {
        session = { user: { id: "m1" } };
        const body = await (await GET()).json();
        expect(body.accounts).toEqual([{ provider: "minecraft", username: "Mavikaplan", avatar: null }]);
        expect(signInMethodsOf).toHaveBeenCalledWith("m1");
        expect(body.signInMethods).toEqual([{
            provider: "discord",
            providerAccountId: "80351110224678912",
            displayName: "mavikaplan",
            connectedAt: "2026-11-11T10:00:00.000Z",
        }]);
    });

    it("never carry a provider's token", async () => {
        session = { user: { id: "m1" } };
        const text = await (await GET()).text();
        expect(text).not.toContain("secret-access");
        expect(text).not.toContain("secret-refresh");
    });
});

describe("a member's public profile", () => {
    it("says nothing about how they sign in", async () => {
        const member = await readMember("Mavikaplan");
        expect(member).not.toBeNull();
        expect(signInMethodsOf).not.toHaveBeenCalled();
        expect(JSON.stringify(member)).not.toContain("discord");
    });
});
