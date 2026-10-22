// @vitest-environment node
/**
 * A Minecraft name somebody has linked cannot be linked again by changing its
 * capitals.
 *
 * Minecraft treats `Steve` and `steve` as one player, but the check that a
 * name was free compared it exactly. When Mojang knows the name its UUID
 * caught the second claim; when it does not, as on an offline-mode server or
 * while Mojang is unreachable, a second member could link `steve` beside the
 * `Steve` already linked, and every lookup by name then found either of them.
 * Both the claim and the confirmation now ask without regard to case.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeTable } from "../game-connect/fake-prisma";

const accounts = fakeTable(() => ({ uuid: null, linkedAt: new Date() }), "id");
const codes = fakeTable(() => ({}), "id");
let signedIn = "member-2";

vi.mock("@/core/sdk/server", () => ({
    prisma: { minecraftAccount: accounts, minecraftLinkCode: codes },
    isAdmin: () => false,
    rateLimits: { auth: {} },
    withRateLimit: (_name: string, handler: unknown) => handler,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readJsonBody: async (request: Request) => request.json(),
}));
vi.mock("@/core/sdk", () => ({ doActionAsync: async () => undefined }));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: signedIn } }) }));
// Mojang does not know the name: an offline-mode server's players never had one.
vi.mock("@/modules/minecraft-link/lib/mojang", () => ({
    MINECRAFT_USERNAME: /^[A-Za-z0-9_]{3,16}$/,
    lookupProfile: async () => null,
}));
const whisper = vi.fn(async () => ({ ok: true }));
vi.mock("@/modules/minecraft-link/lib/whisper", () => ({ whisper }));
vi.mock("@/modules/minecraft-link/lib/link-code", () => ({
    CODE_TTL_MS: 300_000,
    issueCode: async () => "123456",
    redeemCode: async () => ({ ok: true, username: "steve" }),
}));

const { POST: claim } = await import("@/modules/minecraft-link/api/link/route");
const { POST: confirm } = await import("@/modules/minecraft-link/api/link/confirm/route");

function post(body: unknown) {
    return new NextRequest("http://localhost/api/v1/minecraft-link/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    signedIn = "member-2";
    accounts.table.rows = [{ id: "a-1", userId: "member-1", username: "Steve" }];
    codes.table.rows = [];
    whisper.mockClear();
});

describe("claiming a Minecraft name", () => {
    it("is refused when another member linked it with other capitals", async () => {
        const res = await claim(post({ username: "steve" }));

        expect(res.status).toBe(409);
        await expect(res.json()).resolves.toMatchObject({ error: "already_linked" });
        expect(whisper).not.toHaveBeenCalled();
    });

    it("is allowed to the member who already holds it", async () => {
        signedIn = "member-1";

        expect((await claim(post({ username: "steve" }))).status).not.toBe(409);
    });
});

describe("confirming the code", () => {
    it("is refused when the name was linked with other capitals in the meantime", async () => {
        const res = await confirm(post({ code: "123456" }));

        expect(res.status).toBe(409);
        expect(accounts.table.rows).toHaveLength(1);
    });
});
