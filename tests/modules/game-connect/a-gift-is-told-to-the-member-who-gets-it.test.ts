// @vitest-environment node
/**
 * A gift lands pending in the recipient's chest, and they have to accept it.
 * A recipient who is in game when it arrives is told, on whichever server
 * they are: the event names each game account linked to them, and a server
 * says it to the player it finds under that account.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const users: Record<string, { username: string }> = { u_ada: { username: "ada" }, u_bo: { username: "bo" } };
const links = [
    { platform: "minecraft", externalId: "uuid-bo", name: "BoInGame", userId: "u_bo" },
    { platform: "example", externalId: "ex-bo", name: "Bo", userId: "u_bo" },
    { platform: "minecraft", externalId: "uuid-ada", name: "AdaInGame", userId: "u_ada" },
];
const emitted: Array<{ type: string; data: Record<string, unknown>; server: string | null }> = [];

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users[where.id] ?? null) },
        gameConnectLink: {
            findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
                links.filter((link) => where.userId.in.includes(link.userId)),
            ),
        },
    },
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/modules/game-connect/lib/events", () => ({
    emitEvent: vi.fn(async (type: string, data: Record<string, unknown>, server: string | null = null) => {
        emitted.push({ type, data, server });
    }),
}));

const { default: onGiftSent } = await import("@/modules/game-connect/hooks/on-gift-sent");

beforeEach(() => {
    emitted.length = 0;
});

describe("a gift sent", () => {
    it("is told to every game account of the member who gets it, on every server, naming the sender in that game", async () => {
        await onGiftSent({ senderId: "u_ada", recipientId: "u_bo", productName: "Hero rank", quantity: 2 });

        expect(emitted).toHaveLength(2);
        expect(emitted.every((event) => event.type === "gift.received" && event.server === null)).toBe(true);
        expect(emitted[0].data).toEqual({
            player: { id: "uuid-bo", name: "BoInGame" },
            platform: "minecraft",
            member: "bo",
            from: "AdaInGame",
            product: "Hero rank",
            quantity: 2,
        });
        expect(emitted[1].data).toMatchObject({ player: { id: "ex-bo", name: "Bo" }, platform: "example", from: "ada" });
    });

    it("says nothing for a member with no game account", async () => {
        users.u_cy = { username: "cy" };
        await onGiftSent({ senderId: "u_bo", recipientId: "u_cy", productName: "Hero rank", quantity: 1 });
        expect(emitted).toHaveLength(0);
    });

    it("says nothing for a payload it cannot read", async () => {
        await onGiftSent({ senderId: "u_ada", recipientId: "", productName: "x", quantity: 1 });
        await onGiftSent(undefined as never);
        expect(emitted).toHaveLength(0);
    });
});
