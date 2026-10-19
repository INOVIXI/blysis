// @vitest-environment node
/**
 * The link page names the game an account plays in a sentence, so it reads
 * as a name: "the Minecraft account Alex", never "the minecraft account Alex".
 */
import { describe, it, expect } from "vitest";
import { gameName } from "@/modules/game-connect/lib/game-name";

describe("a game in a sentence", () => {
    it("starts with a capital and keeps the rest as the server said it", () => {
        expect(gameName("minecraft")).toBe("Minecraft");
        expect(gameName("example")).toBe("Example");
        expect(gameName("iRacing")).toBe("IRacing");
        expect(gameName(" rust ")).toBe("Rust");
        expect(gameName("")).toBe("");
    });
});
