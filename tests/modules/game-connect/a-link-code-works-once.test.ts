// @vitest-environment node
/**
 * A link is evidence, so the code that makes one is spent the first time.
 *
 * A code is read off a chat line or a web page, so it is short, forgiving of
 * case and dashes, stored only as a hash, and dead after ten minutes. One
 * game account belongs to one member per game, and a code made in game is
 * not a code made on the site: each is confirmed on the other side.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeTable } from "./fake-prisma";

const links = fakeTable(() => ({ createdAt: new Date() }), "id", [
    ["platform", "externalId"],
    ["platform", "userId"],
]);
const codes = fakeTable(() => ({ createdAt: new Date() }), "id", [["codeHash"]]);
const users = fakeTable();

vi.mock("@/core/sdk/server", () => ({
    prisma: { gameConnectLink: links, gameConnectLinkCode: codes, user: users },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { generateCode, hashCode, spend, bind, CODE_TTL_MS } = await import("@/modules/game-connect/lib/links");

function issue(code: string, direction: "game" | "site", expiresAt = new Date(Date.now() + CODE_TTL_MS)) {
    codes.table.rows.push({ id: `c${codes.table.rows.length}`, codeHash: hashCode(code), direction, expiresAt });
}

beforeEach(() => {
    links.table.rows = [];
    codes.table.rows = [];
    users.table.rows = [
        { id: "u1", username: "steve" },
        { id: "u2", username: "alex" },
    ];
});

describe("a link code", () => {
    it("is two groups of four from an alphabet without the misread pairs", () => {
        for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    });

    it("is stored as a hash that ignores case and the dash", () => {
        expect(hashCode("abcd-efgh")).toBe(hashCode("ABCDEFGH"));
        expect(hashCode("ABCD-EFGH")).not.toContain("ABCD");
    });

    it("works once", async () => {
        issue("ABCD-EFGH", "game");

        expect(await spend("abcd-efgh", "game")).not.toBeNull();
        expect(await spend("abcd-efgh", "game")).toBeNull();
    });

    it("is dead once its ten minutes are up, and spent anyway", async () => {
        issue("ABCD-EFGH", "game", new Date(Date.now() - 1));

        expect(await spend("ABCD-EFGH", "game")).toBeNull();
        expect(codes.table.rows).toHaveLength(0);
    });

    it("made on one side is not accepted on the same side", async () => {
        issue("ABCD-EFGH", "site");

        expect(await spend("ABCD-EFGH", "game")).toBeNull();
        expect(codes.table.rows).toHaveLength(1);
    });
});

describe("binding an account", () => {
    it("links a free account to a free member", async () => {
        await expect(bind("minecraft", "uuid-1", "Steve", "u1")).resolves.toEqual({ ok: true, userId: "u1", username: "steve" });
        expect(links.table.rows).toHaveLength(1);
    });

    it("leaves an account somebody else holds with them", async () => {
        await bind("minecraft", "uuid-1", "Steve", "u1");

        await expect(bind("minecraft", "uuid-1", "Steve", "u2")).resolves.toEqual({ ok: false, code: "already_linked" });
    });

    it("gives a member one account per game until they let the first go", async () => {
        await bind("minecraft", "uuid-1", "Steve", "u1");

        await expect(bind("minecraft", "uuid-2", "Steve2", "u1")).resolves.toEqual({ ok: false, code: "already_linked" });
        await expect(bind("steam", "7656", "steve", "u1")).resolves.toMatchObject({ ok: true });
    });

    it("lets one of two confirmations that race for an account in", async () => {
        const answers = await Promise.all([
            bind("minecraft", "uuid-1", "Steve", "u1"),
            bind("minecraft", "uuid-1", "Steve", "u2"),
        ]);

        expect(answers.filter((a) => a.ok)).toHaveLength(1);
        expect(links.table.rows).toHaveLength(1);
    });

    it("is idempotent for the same account and member", async () => {
        await bind("minecraft", "uuid-1", "Steve", "u1");

        await expect(bind("minecraft", "uuid-1", "Steve", "u1")).resolves.toMatchObject({ ok: true });
        expect(links.table.rows).toHaveLength(1);
    });
});
