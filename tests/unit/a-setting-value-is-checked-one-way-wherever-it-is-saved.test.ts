import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sanitizeSettingValue, settingDefault } from "@/core/lib/setting-field-value";
import type { ThemeFieldDef } from "@/core/lib/theme-manifest-schema";

/**
 * A value for a declared setting is checked by one function, wherever it is
 * saved or read.
 *
 * Two theme routes each kept their own copy and the copies disagreed. The
 * settings route took any address starting with "/", so "//evil.example", an
 * address on somebody else's host, was stored as a link; it took a number of
 * any size whatever the field's bounds. The customization route had no case
 * for a number at all, so a number field could never be saved through it.
 * A block's settings are the same fields, so they are checked here too.
 */

const field = (def: unknown) => def as ThemeFieldDef;

describe("a setting value", () => {
    it("is a number within the field's bounds", () => {
        const def = field({ type: "number", min: 1, max: 12 });
        expect(sanitizeSettingValue(def, 4)).toBe(4);
        expect(sanitizeSettingValue(def, 40)).toBeUndefined();
        expect(sanitizeSettingValue(def, "4")).toBeUndefined();
        expect(sanitizeSettingValue(def, Number.NaN)).toBeUndefined();
    });

    it("is an address on this site or an http(s) one, never one on another host", () => {
        const url = field({ type: "url" });
        expect(sanitizeSettingValue(url, "/store")).toBe("/store");
        expect(sanitizeSettingValue(url, "https://discord.gg/x")).toBe("https://discord.gg/x");
        for (const bad of ["//evil.example", "/\\evil.example", "javascript:alert(1)", "data:text/html,x"]) {
            expect(sanitizeSettingValue(url, bad), bad).toBeUndefined();
        }
        expect(sanitizeSettingValue(field({ type: "image" }), "data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    });

    it("is one of a select's options", () => {
        const def = field({ type: "select", options: [{ value: "grid", label: "Grid" }] });
        expect(sanitizeSettingValue(def, "grid")).toBe("grid");
        expect(sanitizeSettingValue(def, "list")).toBeUndefined();
    });

    it("is text no longer than the field allows", () => {
        expect(sanitizeSettingValue(field({ type: "text", max: 3 }), "abcdef")).toBe("abc");
    });

    it("falls back to the field's default, or to the plainest value of its type", () => {
        expect(settingDefault(field({ type: "number", min: 2, max: 9 }))).toBe(2);
        expect(settingDefault(field({ type: "number", default: 4 }))).toBe(4);
        expect(settingDefault(field({ type: "toggle" }))).toBe(false);
        expect(settingDefault(field({ type: "select", options: [{ value: "grid", label: "Grid" }, { value: "list", label: "List" }] }))).toBe("grid");
        expect(settingDefault(field({ type: "text" }))).toBe("");
    });

    it("has no second checker in a theme route", () => {
        // The customization route kept its colour and font checks after the
        // field checks moved, which is how the two copies started to differ.
        for (const route of ["customization/route.ts", "settings/[group]/route.ts"]) {
            const source = fs.readFileSync(path.join(process.cwd(), "src/app/api/v1/themes/[id]", route), "utf8");
            expect(source, route).toContain("sanitizeSettingValue");
            expect(source, route).not.toMatch(/const (HEX|SAFE_FONT)|function clampString/);
        }
    });
});
