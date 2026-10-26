import { describe, it, expect } from "vitest";
import { linkTarget } from "@/core/lib/setting-link";

/**
 * An address an operator typed into a theme setting becomes a link only when
 * it is a path on this site or an http(s) address. A setting is free text,
 * and `javascript:` in an href runs for every visitor who presses the button.
 */
describe("an address from a setting", () => {
    it("is a path on this site or an http(s) address", () => {
        expect(linkTarget("/store")).toEqual({ href: "/store", external: false });
        expect(linkTarget("  /store  ")).toEqual({ href: "/store", external: false });
        expect(linkTarget("https://discord.gg/x")).toEqual({ href: "https://discord.gg/x", external: true });
    });

    it("is nothing else", () => {
        for (const raw of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "//evil.example", "/\\evil.example", "data:text/html,x", "store", "", null, 42]) {
            expect(linkTarget(raw), String(raw)).toBeNull();
        }
    });
});
