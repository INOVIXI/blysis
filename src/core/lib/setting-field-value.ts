import type { ThemeFieldDef } from "@/core/lib/theme-manifest-schema";

/**
 * What a declared setting may hold, checked the same way wherever a value is
 * saved or read: a theme's settings, its customization and a block's.
 *
 * The two theme routes each had a copy and the copies disagreed: one stored
 * "//evil.example" as a link because it starts with "/", and took a number
 * of any size; the other had no case for a number, so a number field never
 * saved. `a-setting-value-is-checked-one-way-wherever-it-is-saved` holds them
 * to this one.
 */

const HEX = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const SAFE_FONT = /^[A-Za-z0-9 ,._'"-]+$/;
/** A path on this site; "//" and "/\" lead to another host. */
const SITE_PATH = /^\/(?![/\\])/;

function clampString(value: unknown, max: number): string | undefined {
    if (typeof value !== "string") return undefined;
    return value.length > max ? value.slice(0, max) : value;
}

function isSafeAddress(value: unknown, allowImageData: boolean): value is string {
    if (typeof value !== "string") return false;
    if (SITE_PATH.test(value)) return true;
    if (allowImageData && /^data:image\//i.test(value)) return true;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function inBounds(value: unknown, min: number | undefined, max: number | undefined): value is number {
    return typeof value === "number" && Number.isFinite(value)
        && (min === undefined || value >= min) && (max === undefined || value <= max);
}

/**
 * The value as the field may hold it, or `undefined` when it cannot hold it,
 * so a caller drops the value rather than storing or drawing a broken one.
 */
export function sanitizeSettingValue(def: ThemeFieldDef, value: unknown): unknown {
    switch (def.type) {
        case "color":
            return typeof value === "string" && HEX.test(value) ? value : undefined;
        case "font": {
            const font = clampString(value, 100);
            return font !== undefined && SAFE_FONT.test(font) ? font : undefined;
        }
        case "select":
            return typeof value === "string" && def.options.some((o) => o.value === value) ? value : undefined;
        case "slider":
            return inBounds(value, def.min, def.max) ? value : undefined;
        case "number":
            return inBounds(value, def.min, def.max) ? value : undefined;
        case "toggle":
            return typeof value === "boolean" ? value : undefined;
        case "text":
        case "richtext":
            return clampString(value, def.max ?? 10000);
        case "url":
            return isSafeAddress(value, false) ? value : undefined;
        case "image":
            return isSafeAddress(value, true) ? value : undefined;
    }
}

/** The field's declared default, or the plainest value its type holds. */
export function settingDefault(def: ThemeFieldDef): unknown {
    if ("default" in def && def.default !== undefined) return def.default;
    switch (def.type) {
        case "toggle":
            return false;
        case "select":
            return def.options[0]?.value;
        case "slider":
            return def.min;
        case "number":
            return def.min ?? 0;
        default:
            return "";
    }
}
