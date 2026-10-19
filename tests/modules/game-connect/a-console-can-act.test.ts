// @vitest-environment node
/**
 * Staff change credits and mint vouchers from a game server's console as
 * often as from inside the game, and a console is nobody's game account: it
 * has a name and no id. The routes read only the actor's name, so an actor
 * without an id is one, and the console's commands are not refused as a
 * malformed body. Found live: every staff command typed on the console came
 * back as invalid_request.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/core/sdk/server", () => ({ prisma: {} }));

const { actorField } = await import("@/modules/game-connect/lib/schemas");

describe("the actor of a staff change", () => {
    it("is a player, with their id and name", () => {
        expect(actorField.safeParse({ id: "069a79f4-44e9-4726-a5be-fca90e38aaf5", name: "Notch" }).success).toBe(true);
    });

    it("may be a console, which has a name and no id", () => {
        expect(actorField.safeParse({ id: null, name: "CONSOLE" }).success).toBe(true);
        expect(actorField.safeParse({ name: "CONSOLE" }).success).toBe(true);
    });

    it("always has a name, and nothing longer than a name", () => {
        expect(actorField.safeParse({ id: null, name: "" }).success).toBe(false);
        expect(actorField.safeParse({ id: "x", name: "a".repeat(65) }).success).toBe(false);
        expect(actorField.safeParse({ id: "x".repeat(65), name: "a" }).success).toBe(false);
    });
});
