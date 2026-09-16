// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Changing the address on an account, and the two ways it goes wrong.
 *
 * The address is the account: a password reset goes there, so whoever
 * controls the mailbox controls the login. That makes this field different
 * from every other one on a profile screen.
 *
 * So the new address is not written onto the account when somebody asks for
 * it. It is held aside until a link sent to it comes back. A typo therefore
 * costs nothing - the account keeps the address that works - and somebody who
 * types a stranger's address cannot take the account with it, because the
 * stranger is the one who gets the link.
 *
 * And the old address is told. Somebody whose screen was borrowed for a
 * minute finds a message saying what was asked for, which is the only warning
 * a hijack of this kind gives.
 */

const settings = new Map<string, unknown>();
const user = { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() };
const emailChange = { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() };
const sent: { to: string; kind: string }[] = [];

vi.mock("@/core/lib/db", () => ({ prisma: { user, emailChange, setting: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/core/lib/setting-values", () => ({
    readSettingValues: async (keys: string[]) =>
        Object.fromEntries(keys.map((key) => [key, settings.get(key)])),
}));
vi.mock("@/core/lib/email", () => ({
    sendEmailChangeVerification: async (to: string) => { sent.push({ to, kind: "verify" }); return true; },
    sendEmailChangeNotice: async (to: string) => { sent.push({ to, kind: "notice" }); return true; },
}));

const { requestEmailChange, confirmEmailChange } = await import("@/core/lib/email-change");

beforeEach(() => {
    vi.clearAllMocks();
    settings.clear();
    sent.length = 0;
    user.findFirst.mockResolvedValue(null);
    emailChange.upsert.mockResolvedValue({});
    user.update.mockResolvedValue({});
});

describe("asking for a new address", () => {
    it("is refused outright when the operator has not opened that door", async () => {
        const answer = await requestEmailChange({ userId: "u1", currentEmail: "old@site.test", newEmail: "new@site.test" });
        expect(answer).toEqual({ ok: false, code: "email_changes_closed" });
        expect(emailChange.upsert).not.toHaveBeenCalled();
    });

    it("leaves the account's address exactly as it was", async () => {
        settings.set("member_email_changes", true);
        await requestEmailChange({ userId: "u1", currentEmail: "old@site.test", newEmail: "new@site.test" });
        expect(user.update).not.toHaveBeenCalled();
    });

    it("sends the link to the address being claimed, and a warning to the one on file", async () => {
        settings.set("member_email_changes", true);
        await requestEmailChange({ userId: "u1", currentEmail: "old@site.test", newEmail: "new@site.test" });
        expect(sent).toEqual([
            { to: "new@site.test", kind: "verify" },
            { to: "old@site.test", kind: "notice" },
        ]);
    });

    it("refuses an address somebody else already answers to", async () => {
        settings.set("member_email_changes", true);
        user.findFirst.mockResolvedValue({ id: "u2" });
        const answer = await requestEmailChange({ userId: "u1", currentEmail: "old@site.test", newEmail: "taken@site.test" });
        expect(answer).toEqual({ ok: false, code: "email_taken" });
    });

    it("takes the account's own address as nothing to do", async () => {
        settings.set("member_email_changes", true);
        const answer = await requestEmailChange({ userId: "u1", currentEmail: "old@site.test", newEmail: "old@site.test" });
        expect(answer).toEqual({ ok: false, code: "email_unchanged" });
    });

    it("writes it straight through when the operator turned verification off", async () => {
        settings.set("member_email_changes", true);
        settings.set("email_change_verification", false);
        const answer = await requestEmailChange({ userId: "u1", currentEmail: "old@site.test", newEmail: "new@site.test" });
        expect(answer).toEqual({ ok: true, verified: false });
        expect(user.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ email: "new@site.test", emailVerified: null }) }),
        );
    });
});

describe("answering the link", () => {
    it("moves the address only then", async () => {
        emailChange.findUnique.mockResolvedValue({
            id: "c1", userId: "u1", newEmail: "new@site.test",
            expiresAt: new Date(Date.now() + 60_000),
        });

        const answer = await confirmEmailChange("a-token");

        expect(answer).toEqual({ ok: true });
        expect(user.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ email: "new@site.test" }) }),
        );
        expect(emailChange.delete).toHaveBeenCalled();
    });

    it("refuses a link whose hour has passed", async () => {
        emailChange.findUnique.mockResolvedValue({
            id: "c1", userId: "u1", newEmail: "new@site.test",
            expiresAt: new Date(Date.now() - 1_000),
        });

        expect(await confirmEmailChange("a-token")).toEqual({ ok: false, code: "token_expired" });
        expect(user.update).not.toHaveBeenCalled();
    });

    it("refuses a link nobody issued", async () => {
        emailChange.findUnique.mockResolvedValue(null);
        expect(await confirmEmailChange("a-token")).toEqual({ ok: false, code: "token_invalid" });
    });

    it("refuses an address that was taken while the link sat in a mailbox", async () => {
        emailChange.findUnique.mockResolvedValue({
            id: "c1", userId: "u1", newEmail: "new@site.test",
            expiresAt: new Date(Date.now() + 60_000),
        });
        user.findFirst.mockResolvedValue({ id: "u2" });

        expect(await confirmEmailChange("a-token")).toEqual({ ok: false, code: "email_taken" });
        expect(user.update).not.toHaveBeenCalled();
    });
});
