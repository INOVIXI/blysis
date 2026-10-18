// @vitest-environment node
/** This module's accounts are Minecraft accounts, so a lookup about another game is not answered here. */
import { describe, it, expect, vi } from "vitest";

const findFirst = vi.fn(async () => ({ userId: "u1" }));
vi.mock("@/core/sdk/server", () => ({ prisma: { minecraftAccount: { findFirst } } }));

const resolve = (await import("@/modules/minecraft-link/hooks/resolve-account")).default;

describe("a Minecraft account lookup", () => {
    it("answers for Minecraft, and for a caller that names no game", async () => {
        await expect(resolve({ userId: null }, { uuid: "id-1", platform: "minecraft" })).resolves.toEqual({ userId: "u1" });
        await expect(resolve({ userId: null }, { uuid: "id-1" })).resolves.toEqual({ userId: "u1" });
    });

    it("does not answer for another game", async () => {
        findFirst.mockClear();
        await expect(resolve({ userId: null }, { uuid: "id-1", platform: "another" })).resolves.toEqual({ userId: null });
        expect(findFirst).not.toHaveBeenCalled();
    });
});
