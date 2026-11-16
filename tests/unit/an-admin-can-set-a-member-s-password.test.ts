// @vitest-environment node
/**
 * An administrator can give a member a new password from the panel.
 *
 * A member who forgot their password resets it by mail, and a fresh site
 * often has no mail set up: the member was locked out with nobody able to
 * let them back in. An administrator could create an account with a password
 * but never change one.
 *
 * The new password answers to the site's policy and the breach check, as a
 * member's own would. Every session the member holds ends, because a person
 * asking for this may be one whose account somebody else is using. Another
 * administrator's password, and the caller's own, stay theirs to change: the
 * panel is not a way into an equal's account.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { id: string; username: string; isDeleted: boolean; password: string | null };

let caller: string | null = "admin-1";
const admins = new Set(["admin-1", "admin-2"]);
let rows: Row[] = [];
let policyOk = true;
let breached = false;
const revoked: Array<{ userId: string; spared: string | null }> = [];
const logged: Array<{ action: string; entityId?: string }> = [];

vi.mock("@/core/lib/auth", () => ({
    auth: async () => (caller ? { user: { id: caller } } : null),
}));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async (id: string) => admins.has(id) }));
vi.mock("@/core/lib/db", () => ({
    prisma: {
        user: {
            findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
            update: async ({ where, data }: { where: { id: string }; data: { password: string } }) => {
                const row = rows.find((r) => r.id === where.id)!;
                row.password = data.password;
                return row;
            },
        },
    },
}));
vi.mock("@/core/lib/security-settings", () => ({
    enforcePasswordPolicy: async () => (policyOk ? { ok: true } : { ok: false, reason: "too_short", message: "Too short" }),
    getHashAlgorithm: async () => "bcrypt",
}));
vi.mock("@/core/lib/password-breach", () => ({ checkPasswordBreach: async () => ({ ok: !breached }) }));
vi.mock("@/core/lib/password-hash", () => ({ hashPassword: async (plain: string) => `hashed:${plain}` }));
vi.mock("@/core/lib/session-registry", () => ({
    revokeSessionsFor: async (userId: string, spared: string | null) => {
        revoked.push({ userId, spared });
        return 1;
    },
}));
vi.mock("@/core/lib/activity-log", () => ({
    logActivity: async (entry: { action: string; entityId?: string }) => {
        logged.push(entry);
    },
}));
vi.mock("@/core/lib/hooks-bootstrap", () => ({ ensureHooks: async () => undefined }));
vi.mock("@/core/lib/hooks", () => ({ doActionAsync: async () => undefined }));
vi.mock("@/core/lib/logger", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const { POST } = await import("@/app/api/v1/users/[id]/password/route");

const setPassword = (id: string, body: unknown) =>
    POST(
        new Request(`http://localhost/api/v1/users/${id}/password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }) as never,
        { params: Promise.resolve({ id }) },
    );

beforeEach(() => {
    caller = "admin-1";
    policyOk = true;
    breached = false;
    revoked.length = 0;
    logged.length = 0;
    rows = [
        { id: "member-1", username: "steve", isDeleted: false, password: "old" },
        { id: "admin-1", username: "owner", isDeleted: false, password: "old" },
        { id: "admin-2", username: "other", isDeleted: false, password: "old" },
        { id: "gone-1", username: "gone", isDeleted: true, password: "old" },
    ];
});

describe("an administrator setting a member's password", () => {
    it("writes the new password and ends every session the member had", async () => {
        const res = await setPassword("member-1", { password: "A-new-password-1" });
        expect(res.status).toBe(200);
        expect(rows[0].password).toBe("hashed:A-new-password-1");
        expect(revoked).toEqual([{ userId: "member-1", spared: null }]);
        expect(logged).toEqual([expect.objectContaining({ action: "admin.user.password.set", entityId: "member-1" })]);
    });

    it("is refused to somebody who is not an administrator", async () => {
        caller = "member-1";
        const res = await setPassword("member-1", { password: "A-new-password-1" });
        expect(res.status).toBe(403);
        expect(rows[0].password).toBe("old");
    });

    it("is refused to nobody signed in", async () => {
        caller = null;
        expect((await setPassword("member-1", { password: "A-new-password-1" })).status).toBe(401);
    });

    it("leaves another administrator's password, and the caller's own, alone", async () => {
        for (const id of ["admin-2", "admin-1"]) {
            const res = await setPassword(id, { password: "A-new-password-1" });
            expect(res.status).toBe(403);
            expect((await res.json()).code).toBe("administrator_password");
        }
        expect(rows.every((r) => r.password === "old")).toBe(true);
        expect(revoked).toHaveLength(0);
    });

    it("holds the new password to the site's policy and the breach check", async () => {
        policyOk = false;
        const weak = await setPassword("member-1", { password: "short" });
        expect(weak.status).toBe(400);
        expect((await weak.json()).code).toBe("weak_password");

        policyOk = true;
        breached = true;
        const known = await setPassword("member-1", { password: "Password1234" });
        expect(known.status).toBe(400);
        expect((await known.json()).code).toBe("password_breached");
        expect(rows[0].password).toBe("old");
    });

    it("finds no account that is gone or never was", async () => {
        expect((await setPassword("gone-1", { password: "A-new-password-1" })).status).toBe(404);
        expect((await setPassword("nobody", { password: "A-new-password-1" })).status).toBe(404);
    });

    it("refuses a body without a password", async () => {
        expect((await setPassword("member-1", {})).status).toBe(400);
    });
});
