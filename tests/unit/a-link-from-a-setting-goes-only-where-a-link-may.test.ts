import { describe, it, expect } from "vitest";
import { linkTarget, webAddress } from "@/core/lib/setting-link";

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

    it("reads a host typed without its scheme as the web address it is", () => {
        // Every theme's Discord button and the footer read the same setting;
        // an operator who typed it the way people type addresses got no button.
        expect(linkTarget("discord.gg/x")).toEqual({ href: "https://discord.gg/x", external: true });
    });

    it("is nothing else", () => {
        for (const raw of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "//evil.example", "/\\evil.example", "data:text/html,x", "store", "", null, 42]) {
            expect(linkTarget(raw), String(raw)).toBeNull();
        }
    });
});

describe("webAddress", () => {
    it("gives a host typed without its scheme the web's", () => {
        expect(webAddress("facebook.com/acme")).toBe("https://facebook.com/acme");
        expect(webAddress(" discord.gg/abc ")).toBe("https://discord.gg/abc");
        expect(webAddress("play.example.net:8080/x")).toBe("https://play.example.net:8080/x");
    });

    it("leaves a path, a named scheme and what is no address as they are", () => {
        expect(webAddress("/discord")).toBe("/discord");
        expect(webAddress("https://x.com/acme")).toBe("https://x.com/acme");
        expect(webAddress("javascript:alert(1)")).toBe("javascript:alert(1)");
        expect(webAddress("not a link")).toBe("not a link");
        expect(linkTarget(webAddress("javascript:alert(1)"))).toBeNull();
    });
});
