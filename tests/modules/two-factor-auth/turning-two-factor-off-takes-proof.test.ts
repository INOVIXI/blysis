// @vitest-environment node
/**
 * Two-factor authentication is turned on by a code, and turned off, or given
 * new backup codes, only with proof.
 *
 * A session alone is not proof: a stolen cookie must not be able to take the
 * second factor off the account it stole, or mint backup codes that get past
 * it. Disabling and regenerating each take the account password or a current
 * code, under a strict rate limit, because both are a guessing loop over a
 * six-digit secret otherwise. Turning it on takes a code from the
 * authenticator, so a secret nobody scanned never guards an account, and the
 * backup codes are stored hashed and shown once.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const user = {
    id: "user-1",
    email: "member@example.com",
    password: "hashed-password",
    twoFactorEnabled: true,
    twoFactorSecret: "SECRET",
    backupCodes: null as string | null,
};

const db = {
    user: {
        findUnique: vi.fn(async () => ({ ...user })),
        update: vi.fn(async () => ({})),
    },
};

const rateLimitStrict = vi.fn(async () => ({ success: true }));

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    rateLimitStrict: (...args: unknown[]) => rateLimitStrict(...(args as [])),
    rateLimitForRoleAsync: vi.fn(async () => true),
    readJsonBody: async (request: Request, opts?: { fallback?: unknown }) => {
        const text = await request.text();
        return text ? JSON.parse(text) : (opts?.fallback ?? {});
    },
    verifyToken: (secret: string, token: string) => secret === "SECRET" && token === "123456",
    verifyPassword: async (password: string, stored: string) => stored === "hashed-password" && password === "right-password",
    generateBackupCodes: () => ({ codes: ["AAAA-BBBB"], hashed: ["hash-of-AAAA-BBBB"] }),
    generateSecret: () => ({ secret: "NEW-SECRET", uri: "otpauth://totp/x" }),
    generateQRCode: async () => "data:image/png;base64,qr",
}));
vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-1", role: "member" } })) }));
vi.mock("@/core/sdk", () => ({ doActionAsync: vi.fn(async () => undefined) }));

const { POST: disable } = await import("@/modules/two-factor-auth/api/disable/route");
const { POST: regenerate } = await import("@/modules/two-factor-auth/api/regenerate-codes/route");
const { POST: verify } = await import("@/modules/two-factor-auth/api/verify/route");
const { POST: setup } = await import("@/modules/two-factor-auth/api/setup/route");
const { auth } = await import("@/core/sdk/auth");

function post(body?: unknown) {
    return new NextRequest("https://shop.example/api/v1/auth/two-factor/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    db.user.findUnique.mockImplementation(async () => ({ ...user }));
    rateLimitStrict.mockResolvedValue({ success: true });
});

describe.each([
    ["disabling", disable],
    ["regenerating backup codes", regenerate],
])("%s", (_name, route) => {
    it("takes a current code", async () => {
        const res = await route(post({ token: "123456" }));
        expect(res.status).toBe(200);
        expect(db.user.update).toHaveBeenCalledTimes(1);
    });

    it("takes the account password", async () => {
        const res = await route(post({ password: "right-password" }));
        expect(res.status).toBe(200);
    });

    it("does nothing with a session and no proof", async () => {
        const res = await route(post({}));
        expect(res.status).toBe(400);
        expect(db.user.update).not.toHaveBeenCalled();
    });

    it("does nothing with a wrong code or a wrong password", async () => {
        expect((await route(post({ token: "000000" }))).status).toBe(401);
        expect((await route(post({ password: "guess" }))).status).toBe(401);
        expect(db.user.update).not.toHaveBeenCalled();
    });

    it("stops answering after its attempts are spent, before reading the proof", async () => {
        rateLimitStrict.mockResolvedValueOnce({ success: false });
        const res = await route(post({ token: "123456" }));
        expect(res.status).toBe(429);
        expect(db.user.findUnique).not.toHaveBeenCalled();
    });

    it("refuses without a session", async () => {
        vi.mocked(auth).mockResolvedValueOnce(null as never);
        const res = await route(post({ token: "123456" }));
        expect(res.status).toBe(401);
        expect(db.user.update).not.toHaveBeenCalled();
    });
});

describe("disabling", () => {
    it("clears the secret and the backup codes with the flag", async () => {
        await disable(post({ token: "123456" }));
        expect(db.user.update).toHaveBeenCalledWith({
            where: { id: "user-1" },
            data: { twoFactorEnabled: false, twoFactorSecret: null, backupCodes: null },
        });
    });
});

describe("turning it on", () => {
    beforeEach(() => {
        db.user.findUnique.mockImplementation(async () => ({ ...user, twoFactorEnabled: false }));
    });

    it("enables it only for a code from the authenticator", async () => {
        const res = await verify(post({ token: "000000" }));
        expect(res.status).toBe(400);
        expect(db.user.update).not.toHaveBeenCalled();
    });

    it("stores the backup codes hashed and shows them once", async () => {
        const res = await verify(post({ token: "123456" }));

        expect(res.status).toBe(200);
        expect(db.user.update).toHaveBeenCalledWith({
            where: { id: "user-1" },
            data: { twoFactorEnabled: true, backupCodes: JSON.stringify(["hash-of-AAAA-BBBB"]) },
        });
        expect((await res.json()).backupCodes).toEqual(["AAAA-BBBB"]);
    });

    it("refuses to start over an account that already has it", async () => {
        db.user.findUnique.mockImplementation(async () => ({ ...user, twoFactorEnabled: true }));
        const res = await setup();
        expect(res.status).toBe(400);
        expect(db.user.update).not.toHaveBeenCalled();
    });
});
