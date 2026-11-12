import { describe, it, expect, vi } from "vitest";

const rows = vi.hoisted(() => ({ value: [] as { key: string; value: unknown }[] }));
vi.mock("@/core/lib/db", () => ({ prisma: { setting: { findMany: async () => rows.value } } }));
vi.mock("@/core/lib/secret-settings", () => ({ settingsFromStorage: (raw: Record<string, unknown>) => raw }));

import { readSettingStrings } from "@/core/lib/setting-values";
import { cleanTranslatableText, isTranslatableText, originalText, textFor } from "@/core/lib/i18n/translatable-text";

/**
 * What an operator typed, in the language of whoever reads it.
 *
 * A site name, a navbar label or a hero heading had one value, shown in every
 * language: a Turkish site with English readers showed Turkish to everyone.
 * The value may now carry a translation per language beside the text the
 * operator typed first. A reader whose language has one reads it; anybody
 * else reads the original, whatever language that was written in. A plain
 * string is still a value and means "the same in every language", so every
 * row written before this reads as it did.
 */

describe("textFor", () => {
    const value = { default: "Sunucuya katıl", en: "Join the server", de: "" };

    it("gives a plain string to every reader", () => {
        expect(textFor("Vanilya", "en")).toBe("Vanilya");
        expect(textFor("Vanilya", "tr")).toBe("Vanilya");
    });

    it("gives the reader's own translation", () => {
        expect(textFor(value, "en")).toBe("Join the server");
    });

    it("gives the original text where the reader's language has no translation", () => {
        expect(textFor(value, "fr")).toBe("Sunucuya katıl");
    });

    it("treats an empty or blank translation as none", () => {
        expect(textFor(value, "de")).toBe("Sunucuya katıl");
        expect(textFor({ default: "Original", it: "   " }, "it")).toBe("Original");
    });

    it("gives the original text to a language the software does not know", () => {
        expect(textFor(value, "xx")).toBe("Sunucuya katıl");
        expect(textFor({ default: "Original", constructor: "nope" }, "constructor")).toBe("Original");
    });

    it("never looks up the site's own language when the reader's is missing", () => {
        // The original was typed in English on a Turkish site. A German
        // reader reads the original, not the Turkish entry.
        expect(textFor({ default: "Store", tr: "Mağaza" }, "de")).toBe("Store");
    });

    it("gives an empty string for nothing at all", () => {
        expect(textFor(undefined, "en")).toBe("");
        expect(textFor(null, "en")).toBe("");
        expect(textFor(42, "en")).toBe("");
        expect(textFor({ en: "no original" }, "en")).toBe("");
    });

    it("is the same answer on every call, so a server render and a browser render agree", () => {
        const runs = Array.from({ length: 3 }, () => textFor(value, "en"));
        expect(new Set(runs).size).toBe(1);
    });
});

describe("a translatable value", () => {
    it("is a string or an object with an original text", () => {
        expect(isTranslatableText("x")).toBe(true);
        expect(isTranslatableText({ default: "x", tr: "y" })).toBe(true);
        expect(isTranslatableText({ tr: "y" })).toBe(false);
        expect(isTranslatableText(["x"])).toBe(false);
        expect(isTranslatableText({ default: "x", tr: 3 })).toBe(false);
    });

    it("has its original text for a reader that knows no language", () => {
        expect(originalText({ default: "Vanilya", en: "Vanilla" })).toBe("Vanilya");
        expect(originalText("Vanilya")).toBe("Vanilya");
        expect(originalText(undefined)).toBe("");
    });
});

describe("cleanTranslatableText", () => {
    it("keeps a string, cut to the limit", () => {
        expect(cleanTranslatableText("abcdef", 3)).toBe("abc");
    });

    it("keeps known languages only, each cut to the limit, and drops empty ones", () => {
        expect(cleanTranslatableText({ default: "abcdef", en: "ghijkl", de: "", xx: "zz", __proto__: "p" }, 3))
            .toEqual({ default: "abc", en: "ghi" });
    });

    it("stores a value with no translation left as the plain string it is", () => {
        expect(cleanTranslatableText({ default: "Vanilya", en: "  " }, 100)).toBe("Vanilya");
    });

    it("refuses anything that is not text", () => {
        expect(cleanTranslatableText(4, 10)).toBeUndefined();
        expect(cleanTranslatableText({ en: "no original" }, 10)).toBeUndefined();
        expect(cleanTranslatableText({ default: "x", en: 3 }, 10)).toBeUndefined();
        expect(cleanTranslatableText(["x"], 10)).toBeUndefined();
    });
});

describe("readSettingStrings", () => {
    // A module reading the site's name as a string was handed nothing once
    // the name was written per language, and fell back to the product's.
    it("reads text written per language as its original", async () => {
        rows.value = [{ key: "site_name", value: { default: "Vanilya", en: "Vanilla" } }];
        expect(await readSettingStrings(["site_name"])).toEqual({ site_name: "Vanilya" });
    });
});
