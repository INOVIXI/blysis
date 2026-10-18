// @vitest-environment node
/**
 * Money follows a name typed in game, so the name has to mean one member.
 *
 * A player name reaches a member through a link, and a site username reaches
 * one directly. When the two point at different members, or two links still
 * carry one name because the site has not seen a rename yet, there is no
 * right answer, and guessing would send credits or a gift to a stranger.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeTable } from "./fake-prisma";

const links = fakeTable();
const users = fakeTable();

vi.mock("@/core/sdk/server", () => ({
    prisma: { gameConnectLink: links, user: users },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: vi.fn(async (_hook: string, value: unknown) => value) }));

const { memberNamed } = await import("@/modules/game-connect/lib/players");

const minecraft = { game: "minecraft" };

beforeEach(() => {
    links.table.rows = [];
    users.table.rows = [
        { id: "u1", username: "steve" },
        { id: "u2", username: "alex" },
    ];
});

describe("a name typed in game", () => {
    it("finds the member whose linked player carries it", async () => {
        links.table.rows.push({ id: "l1", platform: "minecraft", externalId: "a", name: "Notch", userId: "u2" });

        await expect(memberNamed(minecraft, "notch")).resolves.toEqual({ userId: "u2", username: "alex" });
    });

    it("finds a member by their site username", async () => {
        await expect(memberNamed(minecraft, "STEVE")).resolves.toEqual({ userId: "u1", username: "steve" });
    });

    it("means nobody when a player name and a username belong to different members", async () => {
        links.table.rows.push({ id: "l1", platform: "minecraft", externalId: "a", name: "steve", userId: "u2" });

        await expect(memberNamed(minecraft, "steve")).resolves.toBeNull();
    });

    it("means nobody when two links still carry it", async () => {
        links.table.rows.push(
            { id: "l1", platform: "minecraft", externalId: "a", name: "Notch", userId: "u1" },
            { id: "l2", platform: "minecraft", externalId: "b", name: "Notch", userId: "u2" },
        );

        await expect(memberNamed(minecraft, "Notch")).resolves.toBeNull();
    });

    it("is the same member when their player name and username agree", async () => {
        links.table.rows.push({ id: "l1", platform: "minecraft", externalId: "a", name: "steve", userId: "u1" });

        await expect(memberNamed(minecraft, "steve")).resolves.toEqual({ userId: "u1", username: "steve" });
    });

    it("reads only the links of this server's game", async () => {
        links.table.rows.push({ id: "l1", platform: "steam", externalId: "765", name: "Notch", userId: "u2" });

        await expect(memberNamed(minecraft, "Notch")).resolves.toBeNull();
    });
});
