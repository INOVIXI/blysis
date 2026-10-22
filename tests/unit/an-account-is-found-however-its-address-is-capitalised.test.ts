// @vitest-environment node
/**
 * A member can reset a forgotten password whatever case they type their
 * address in, and an address registers once however it is capitalised.
 *
 * Registration stored the address as it was typed. The reset request and the
 * reset link both lowercase what they are given and then looked for exactly
 * that, so an account registered as `Admin@Example.com` never received a
 * reset link at all: its owner was told one had been sent, and it had not.
 * Registration now stores the address lowercased, and the two reset routes
 * find an account the way sign-in does (`accountFor`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeTable } from "../modules/game-connect/fake-prisma";

const users = fakeTable(() => ({ password: "old-hash", isBanned: false, isDeleted: false, locale: "en" }), "id", [["email"], ["username"]]);
const tokens = fakeTable(() => ({}), "id");
const sent: { to: string; url: string }[] = [];

vi.mock("@/core/lib/db", () => ({
    prisma: {
        user: users,
        verificationToken: tokens,
        role: { upsert: vi.fn(async () => ({ id: "role-member" })) },
    },
}));
vi.mock("@/core/lib/email", () => ({
    sendPasswordResetEmail: vi.fn(async (to: string, url: string) => {
        sent.push({ to, url });
    }),
    sendWelcomeEmail: async () => undefined,
}));
vi.mock("@/core/lib/rate-limit", () => ({
    rateLimit: async () => ({ success: true }),
    getClientIP: () => "203.0.113.9",
    rateLimits: { auth: {} },
}));
vi.mock("@/core/lib/auth-challenge", () => ({ runChallenge: async () => ({ ok: true }) }));
vi.mock("@/core/lib/app-url", () => ({ resolveAppUrl: () => "https://site.example" }));
vi.mock("@/core/lib/logger", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("@/core/lib/security-settings", () => ({
    PASSWORD_RESET_EXPIRY: "password_reset_expiry",
    getDurationMs: async () => 3_600_000,
    enforcePasswordPolicy: async () => ({ ok: true }),
    getHashAlgorithm: async () => "bcrypt",
    getRegistrationCaps: async () => ({ daily: 0, total: 0 }),
    getUsernameRule: async () => ({ rule: "default", minLength: 3 }),
}));
vi.mock("@/core/lib/password-breach", () => ({ checkPasswordBreach: async () => ({ ok: true }) }));
vi.mock("@/core/lib/password-hash", () => ({ hashPassword: async () => "new-hash" }));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: async () => undefined }));
vi.mock("@/core/lib/session-registry", () => ({ revokeSessionsFor: async () => undefined }));
vi.mock("@/core/lib/hooks-bootstrap", () => ({ ensureHooks: async () => undefined }));
vi.mock("@/core/lib/hooks", () => ({ doActionAsync: async () => undefined }));

const { POST: forgot } = await import("@/app/api/v1/auth/forgot-password/route");
const { POST: reset } = await import("@/app/api/v1/auth/reset-password/route");
const { POST: register } = await import("@/app/api/v1/auth/register/route");

function post(body: unknown) {
    return new NextRequest("https://site.example/api/v1/auth/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    users.table.rows = [{ id: "u-1", email: "Admin@Example.com", username: "admin" }];
    tokens.table.rows = [];
    sent.length = 0;
});

describe("resetting a forgotten password", () => {
    it("sends the link to an account registered with capitals in its address", async () => {
        await forgot(post({ email: "admin@example.com" }));

        expect(sent).toHaveLength(1);
        expect(tokens.table.rows).toHaveLength(1);
    });

    it("sets the new password from that link", async () => {
        await forgot(post({ email: "ADMIN@example.com" }));
        const link = new URL(sent[0].url);

        const res = await reset(post({ email: link.searchParams.get("email"), token: link.searchParams.get("token"), password: "A-new-password-9" }));

        expect(res.status).toBe(200);
        expect(users.table.rows[0].password).toBe("new-hash");
    });
});

describe("registering", () => {
    it("stores the address lowercased", async () => {
        users.table.rows = [];
        const res = await register(post({ email: "New.Member@Example.com", username: "newmember", password: "Correct-horse-9", confirmPassword: "Correct-horse-9" }));

        expect(res.status).toBe(201);
        expect(users.table.rows[0].email).toBe("new.member@example.com");
    });

    it("refuses an address already registered under other capitals", async () => {
        const res = await register(post({ email: "admin@EXAMPLE.com", username: "someoneelse", password: "Correct-horse-9", confirmPassword: "Correct-horse-9" }));

        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("already_registered");
        expect(users.table.rows).toHaveLength(1);
    });
});
