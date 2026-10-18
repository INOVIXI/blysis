// @vitest-environment node
/**
 * A game server says who its player is, and the id is whatever it sends. The
 * same string sent by a server of another game is somebody else, so a link
 * made on one game must never answer for another, and never be copied to it.
 *
 * It did: a server of a second game asked about a player id, this module's
 * own resolver found the id's link on the first game, and the lookup copied
 * it across. The account was linked on the second game with no code.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const links: { platform: string; externalId: string; userId: string; name: string; linkedAt: Date }[] = [];
const created: unknown[] = [];

function matches(where: Record<string, unknown>, row: Record<string, unknown>) {
    return Object.entries(where).every(([k, v]) => row[k] === v);
}

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        gameConnectLink: {
            findUnique: vi.fn(async ({ where }: { where: { platform_externalId: Record<string, string> } }) =>
                links.find((row) => matches(where.platform_externalId, row)) ?? null,
            ),
            findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => links.find((row) => matches(where, row)) ?? null),
            create: vi.fn(async ({ data }: { data: unknown }) => {
                created.push(data);
                return data;
            }),
            update: vi.fn(async () => undefined),
        },
        user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, username: where.id })) },
    },
}));

const resolveAccount = (await import("@/modules/game-connect/hooks/resolve-account")).default;

vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (_hook: string, value: unknown, context: Record<string, unknown>) =>
        resolveAccount(value as { userId: string | null }, context),
    ),
}));

const { memberOf } = await import("@/modules/game-connect/lib/players");

beforeEach(() => {
    links.length = 0;
    created.length = 0;
    links.push({ platform: "first", externalId: "id-1", userId: "u1", name: "Ada", linkedAt: new Date() });
});

describe("an account id", () => {
    it("finds its member on the game it was linked on", async () => {
        await expect(memberOf({ game: "first" }, { id: "id-1", name: "Ada" })).resolves.toEqual({ userId: "u1", username: "u1" });
    });

    it("finds nobody on another game, and links nothing there", async () => {
        await expect(memberOf({ game: "second" }, { id: "id-1", name: "Ada" })).resolves.toBeNull();
        expect(created).toEqual([]);
    });

    it("is answered across games only for a caller that names no game", async () => {
        await expect(resolveAccount({ userId: null }, { uuid: "id-1" })).resolves.toEqual({ userId: "u1" });
        await expect(resolveAccount({ userId: null }, { uuid: "id-1", platform: "second" })).resolves.toEqual({ userId: null });
        await expect(resolveAccount({ userId: null }, { uuid: "id-1", platform: "first" })).resolves.toEqual({ userId: "u1" });
    });
});
