// @vitest-environment node
/**
 * A username belongs to one person, however it is capitalised.
 *
 * The column's unique key is exact, so `Admin` and `admin` are two rows to
 * PostgreSQL and one name to everybody reading a forum post, a staff page or
 * an in-game chat line. A member registering `Admin` beside the real `admin`,
 * or renaming themselves to it, is wearing somebody else's name. Every route
 * that hands out a username asks the question the way a reader would.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeTable } from "../modules/game-connect/fake-prisma";

const users = fakeTable(() => ({ password: "hashed", roleId: "role-member", isBanned: false }), "id", [["username"], ["email"]]);
const session = { user: { id: "u-mallory", role: "member" } };

vi.mock("@/core/lib/db", () => ({
    prisma: {
        user: users,
        role: {
            upsert: vi.fn(async () => ({ id: "role-member" })),
            findUnique: vi.fn(async () => ({ id: "role-member" })),
        },
    },
}));
vi.mock("@/core/lib/auth", () => ({ auth: vi.fn(async () => session) }));
vi.mock("@/core/lib/hooks-bootstrap", () => ({ ensureHooks: async () => undefined }));
vi.mock("@/core/lib/hooks", () => ({ doActionAsync: async () => undefined, HookNames: {} }));
vi.mock("@/core/lib/email", () => ({ sendWelcomeEmail: async () => undefined }));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: async () => undefined }));
vi.mock("@/core/lib/logger", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/core/lib/rate-limit", () => ({
    rateLimit: async () => ({ success: true }),
    getClientIP: () => "203.0.113.7",
    rateLimits: { auth: {} },
}));
vi.mock("@/core/lib/password-hash", () => ({
    hashPassword: async () => "hashed",
    verifyPassword: async () => true,
}));
vi.mock("@/core/lib/password-breach", () => ({ checkPasswordBreach: async () => ({ ok: true }) }));
vi.mock("@/core/lib/security-settings", () => ({
    enforcePasswordPolicy: async () => ({ ok: true }),
    getHashAlgorithm: async () => "bcrypt",
    getRegistrationCaps: async () => ({ daily: 0, total: 0 }),
    getUsernameRule: async () => ({ rule: "default", minLength: 3 }),
}));
vi.mock("@/core/lib/auth-challenge", () => ({ runChallenge: async () => ({ ok: true }) }));
vi.mock("@/core/lib/setting-values", () => ({ readSettingValues: async () => ({}) }));
vi.mock("@/core/lib/email-change", () => ({ requestEmailChange: async () => ({ ok: true, verified: false }) }));
vi.mock("@/core/lib/session-registry", () => ({
    callerSessionTokenId: async () => null,
    revokeSessionsFor: async () => undefined,
}));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async () => true }));
vi.mock("@/core/lib/last-administrator", () => ({ wouldStrandTheSite: async () => false }));

const { POST: register } = await import("@/app/api/v1/auth/register/route");
const { PATCH: editProfile } = await import("@/app/api/v1/auth/profile/route");
const { PATCH: adminEdit } = await import("@/app/api/v1/users/[id]/route");
const me = await import("@/app/api/v1/users/me/route");

function send(method: string, body: unknown) {
    return new NextRequest("https://site.example/api/v1/x", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

function signUp(username: string) {
    return register(send("POST", {
        email: `${username.toLowerCase()}-${Math.random()}@site.example`,
        username,
        password: "Correct-horse-9",
        confirmPassword: "Correct-horse-9",
    }));
}

function names() {
    return users.table.rows.map((row) => row.username);
}

beforeEach(() => {
    users.table.rows = [
        { id: "u-admin", email: "admin@site.example", username: "admin" },
        { id: "u-mallory", email: "mallory@site.example", username: "mallory" },
    ];
});

describe("registering", () => {
    it("refuses a name somebody already has under another capitalisation", async () => {
        const res = await signUp("Admin");

        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("already_registered");
        expect(names()).toEqual(["admin", "mallory"]);
    });

    it("still takes a name nobody has", async () => {
        const res = await signUp("Newcomer");
        expect(res.status).toBe(201);
    });
});

describe("renaming yourself", () => {
    it("refuses somebody else's name under another capitalisation", async () => {
        const res = await editProfile(send("PATCH", { username: "ADMIN", currentPassword: "pw" }));

        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("username_taken");
        expect(names()).toEqual(["admin", "mallory"]);
    });

    it("lets a member recapitalise their own name", async () => {
        const res = await editProfile(send("PATCH", { username: "Mallory", currentPassword: "pw" }));

        expect(res.status).toBe(200);
        expect(names()).toEqual(["admin", "Mallory"]);
    });

    // The profile route is where the operator's switches live: whether
    // members may rename at all, and whether it takes their password. A
    // second write path under another name answered to none of them.
    it("has one way in, the one that asks the operator's rules", () => {
        expect("PATCH" in me).toBe(false);
    });
});

describe("an admin renaming somebody", () => {
    const params = { params: Promise.resolve({ id: "u-mallory" }) };

    it("refuses a name another account has, and says so", async () => {
        const res = await adminEdit(send("PATCH", { username: "Admin" }), params);

        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("username_taken");
        expect(names()).toEqual(["admin", "mallory"]);
    });

    it("refuses the exact name too, rather than failing with a server error", async () => {
        const res = await adminEdit(send("PATCH", { username: "admin" }), params);
        expect(res.status).toBe(409);
    });

    it("may recapitalise the account's own name", async () => {
        const res = await adminEdit(send("PATCH", { username: "MALLORY" }), params);

        expect(res.status).toBe(200);
        expect(names()).toEqual(["admin", "MALLORY"]);
    });
});
