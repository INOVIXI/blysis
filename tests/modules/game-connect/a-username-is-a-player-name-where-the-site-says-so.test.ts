// @vitest-environment node
/**
 * Some sites share accounts with their game: a member registers in game, and
 * the site account carries the player's name. There a code proves nothing a
 * name does not, so an operator can say a member's username is their player
 * name on a game. Every lookup then answers from the name, both ways, without
 * writing a link, so turning the setting off leaves the site as it was.
 *
 * A link a member made with a code still wins, and a name that could mean two
 * members means none: money and punishments follow the answer.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeTable } from "./fake-prisma";

const links = fakeTable(() => ({ linkedAt: new Date() }));
const users = fakeTable();
const servers = fakeTable();
const codes = fakeTable();
const settings: Record<string, unknown> = {};

vi.mock("@/core/sdk/server", () => ({
    prisma: { gameConnectLink: links, gameConnectLinkCode: codes, gameConnectServer: servers, user: users },
    moduleSettings: vi.fn(async () => ({ ...settings })),
    rateLimitStrict: vi.fn(async () => ({ success: true })),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: vi.fn(async (_hook: string, value: unknown) => value) }));
vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", role: "user" } })) }));

const { memberOf } = await import("@/modules/game-connect/lib/players");
const { offlineId } = await import("@/modules/game-connect/lib/names");
const { default: resolveAccount } = await import("@/modules/game-connect/hooks/resolve-account");
const { default: profileAccounts } = await import("@/modules/game-connect/hooks/profile-linked-accounts");
const linksRoute = await import("@/modules/game-connect/api/links/route");
const codeRoute = await import("@/modules/game-connect/api/link/code/route");

const minecraft = { game: "minecraft" };

function setNames(games: string, offlineIds = false) {
    settings.usernamePlayerGames = games;
    settings.offlineModeIds = offlineIds;
}

beforeEach(() => {
    for (const key of Object.keys(settings)) delete settings[key];
    links.table.rows = [];
    codes.table.rows = [];
    servers.table.rows = [{ id: "s1", gameServerId: "gs1", enabled: true, game: "minecraft" }];
    users.table.rows = [
        { id: "u1", username: "Steve" },
        { id: "u2", username: "alex" },
    ];
});

describe("an offline-mode id", () => {
    it("is the one a Java offline-mode server derives from the name, case and all", () => {
        // Printed by Java: UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8)).
        expect(offlineId("Notch")).toBe("b50ad385-829d-3141-a216-7e7d7539ba7f");
        expect(offlineId("notch")).toBe("42653081-a90e-3475-b3d6-3550cdb43f8e");
        expect(offlineId("Çağrı")).toBe("86859bef-23ac-3646-9c7c-44c90100badd");
    });
});

describe("with the setting off", () => {
    it("a player is nobody until they link, whatever their name", async () => {
        await expect(memberOf(minecraft, { id: "p-1", name: "Steve" })).resolves.toBeNull();
        await expect(resolveAccount({ userId: null }, { username: "Steve", platform: "minecraft" })).resolves.toEqual({ userId: null });
    });

    it("a profile shows no player by name", async () => {
        await expect(profileAccounts([], { userId: "u1" })).resolves.toEqual([]);
    });

    it("the link page offers codes and names no player", async () => {
        const res = await linksRoute.GET();
        await expect(res.json()).resolves.toEqual({ links: [], byName: [], codes: true });
    });
});

describe("with usernames as player names on a game", () => {
    beforeEach(() => setNames("Minecraft"));

    it("a player is the member with their name, in any case, and no link is written", async () => {
        await expect(memberOf(minecraft, { id: "p-1", name: "STEVE" })).resolves.toEqual({ userId: "u1", username: "Steve" });
        expect(links.table.rows).toEqual([]);
    });

    it("answers only on the games it names", async () => {
        await expect(memberOf({ game: "example" }, { id: "p-1", name: "Steve" })).resolves.toBeNull();
        await expect(resolveAccount({ userId: null }, { username: "Steve", platform: "example" })).resolves.toEqual({ userId: null });
    });

    it("lets a link made with a code win over the name", async () => {
        links.table.rows.push({ id: "l1", platform: "minecraft", externalId: "p-1", name: "Steve", userId: "u2" });

        await expect(memberOf(minecraft, { id: "p-1", name: "Steve" })).resolves.toEqual({ userId: "u2", username: "alex" });
        await expect(resolveAccount({ userId: null }, { uuid: "p-1", username: "Steve", platform: "minecraft" })).resolves.toEqual({ userId: "u2" });
    });

    it("means nobody when two usernames differ only by case", async () => {
        users.table.rows.push({ id: "u3", username: "steve" });

        await expect(memberOf(minecraft, { id: "p-1", name: "Steve" })).resolves.toBeNull();
        await expect(resolveAccount({ userId: null }, { username: "Steve", platform: "minecraft" })).resolves.toEqual({ userId: null });
        await expect(profileAccounts([], { userId: "u1" })).resolves.toEqual([]);
    });

    it("means nobody when another member's link carries the name", async () => {
        links.table.rows.push({ id: "l1", platform: "minecraft", externalId: "p-9", name: "steve", userId: "u2" });

        await expect(memberOf(minecraft, { id: "p-1", name: "Steve" })).resolves.toBeNull();
        await expect(profileAccounts([], { userId: "u1" })).resolves.toEqual([]);
    });

    it("tells another module which member a player name is", async () => {
        await expect(resolveAccount({ userId: null }, { username: "steve", platform: "minecraft" })).resolves.toEqual({ userId: "u1" });
        await expect(resolveAccount({ userId: null }, { username: "steve" })).resolves.toEqual({ userId: "u1" });
    });

    it("shows a member's player on their profile, or the one they linked", async () => {
        await expect(profileAccounts([], { userId: "u1" })).resolves.toEqual([{ provider: "minecraft", username: "Steve", avatar: null }]);

        links.table.rows.push({ id: "l1", platform: "minecraft", externalId: "p-2", name: "Alexander", userId: "u2" });
        await expect(profileAccounts([], { userId: "u2" })).resolves.toEqual([{ provider: "minecraft", username: "Alexander", avatar: null }]);
    });

    it("leaves a game another module answered for on the profile to that answer", async () => {
        const fromAnother = { provider: "minecraft", username: "Steve", avatar: null };

        await expect(profileAccounts([fromAnother], { userId: "u1" })).resolves.toEqual([fromAnother]);
    });

    it("shows the player on the link page and refuses a code when every connected game links by name", async () => {
        const res = await linksRoute.GET();
        await expect(res.json()).resolves.toEqual({ links: [], byName: [{ platform: "minecraft", name: "Steve" }], codes: false });

        const made = await codeRoute.POST();
        expect(made.status).toBe(409);
        await expect(made.json()).resolves.toMatchObject({ code: "linked_by_name" });
        expect(codes.table.rows).toEqual([]);
    });

    it("keeps codes for a connected game that does not link by name", async () => {
        servers.table.rows.push({ id: "s2", gameServerId: "gs2", enabled: true, game: "example" });

        const res = await linksRoute.GET();
        await expect(res.json()).resolves.toMatchObject({ codes: true });
        expect((await codeRoute.POST()).status).toBe(200);
    });
});

describe("with offline-mode ids", () => {
    beforeEach(() => setNames("minecraft", true));

    it("a player is matched by name only with the id their name derives", async () => {
        await expect(memberOf(minecraft, { id: offlineId("Steve"), name: "Steve" })).resolves.toEqual({ userId: "u1", username: "Steve" });
        await expect(memberOf(minecraft, { id: "069a79f4-44e9-4726-a5be-fca90e38aaf5", name: "Steve" })).resolves.toBeNull();
        await expect(resolveAccount({ userId: null }, { uuid: "not-derived", username: "Steve", platform: "minecraft" })).resolves.toEqual({ userId: null });
        await expect(resolveAccount({ userId: null }, { uuid: offlineId("Steve"), username: "Steve", platform: "minecraft" })).resolves.toEqual({ userId: "u1" });
    });
});
