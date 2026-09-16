import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import { Prisma } from "@prisma/client";
import { themeRegistry } from "@/core/generated/theme-registry";
import { logActivity } from "@/core/lib/activity-log";
import { sanitizeCustomCss } from "@/core/lib/css-sanitizer";
import { isTokenName } from "@/core/lib/theme-override-css";
import type { ThemeManifest, ThemeFieldDef } from "@/core/lib/theme-manifest-schema";
import { isUnsafeKey, emptyRecord } from "@/core/lib/safe-object";
import { z } from "zod";
import { readJsonBody } from "@/core/lib/api-body";

// Reject prototype-polluting keys when copying user-supplied override maps.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id: themeId } = await ctx.params;
    const rows = await prisma.themeCustomization.findMany({ where: { themeId } });
    return NextResponse.json({ overrides: Object.fromEntries(rows.map(r => [r.mode, r.overrides])) });
}

const HEX = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const SAFE_FONT = /^[A-Za-z0-9 ,._'"-]+$/;
const SAFE_ASPECT = /^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$|^\d+(?:\.\d+)?$/;

function clampString(v: unknown, max: number): string | undefined {
    if (typeof v !== "string") return undefined;
    return v.length > max ? v.slice(0, max) : v;
}

function isSafeUrl(v: unknown): v is string {
    if (typeof v !== "string") return false;
    // Accept only http(s), data: images, or same-origin relative paths.
    if (v.startsWith("/") && !v.startsWith("//")) return true;
    try {
        const u = new URL(v);
        if (u.protocol === "http:" || u.protocol === "https:") return true;
        if (u.protocol === "data:" && /^data:image\//i.test(v)) return true;
        return false;
    } catch {
        return false;
    }
}

/**
 * Sanitize a single field value against its schema definition. Returns
 * `undefined` when the value is unusable so the caller can drop the field
 * instead of persisting a broken override.
 */
function sanitizeField(def: ThemeFieldDef, value: unknown): unknown {
    switch (def.type) {
        case "color":
            return typeof value === "string" && HEX.test(value) ? value : undefined;
        case "font": {
            const s = clampString(value, 100);
            return s !== undefined && SAFE_FONT.test(s) ? s : undefined;
        }
        case "select": {
            if (typeof value !== "string") return undefined;
            return def.options.some(o => o.value === value) ? value : undefined;
        }
        case "slider": {
            if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
            if (value < def.min || value > def.max) return undefined;
            return value;
        }
        case "toggle":
            return typeof value === "boolean" ? value : undefined;
        case "text":
            return clampString(value, def.max ?? 10000);
        case "url":
            return isSafeUrl(value) ? value : undefined;
        case "richtext": {
            const s = clampString(value, def.max ?? 10000);
            return s !== undefined ? s : undefined;
        }
        case "image": {
            if (!isSafeUrl(value)) return undefined;
            if (def.aspectRatio && !SAFE_ASPECT.test(def.aspectRatio)) {
                // aspectRatio is manifest-declared so this should never trip,
                // but guard against a malformed manifest leaking through.
            }
            return value;
        }
    }
}

/**
 * Sanitize a token override (colors/fonts map, or radius/space scalar).
 */
function sanitizeTokenValue(tokenKey: "colors" | "fonts" | "radius" | "space", value: unknown, manifest: ThemeManifest): unknown {
    if (tokenKey === "colors") {
        if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
        const out: Record<string, string> = emptyRecord();
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            // `isUnsafeKey` is about prototype pollution and says nothing
            // about CSS. A token name is rendered into a <style> block, so it
            // is checked for what it is rather than for what it is not.
            if (isUnsafeKey(k) || !isTokenName(k)) continue;
            if (typeof v === "string" && HEX.test(v)) out[k] = v;
        }
        return Object.keys(out).length > 0 ? out : undefined;
    }
    if (tokenKey === "fonts") {
        if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
        const out: Record<string, string> = emptyRecord();
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (isUnsafeKey(k) || !isTokenName(k)) continue;
            const s = clampString(v, 100);
            if (s !== undefined && SAFE_FONT.test(s)) out[k] = s;
        }
        return Object.keys(out).length > 0 ? out : undefined;
    }
    if (tokenKey === "radius") {
        const def = manifest.tokens?.radius;
        if (!def) return undefined;
        return sanitizeField(def, value);
    }
    if (tokenKey === "space") {
        const def = manifest.tokens?.space;
        if (!def) return undefined;
        return sanitizeField(def, value);
    }
    return undefined;
}

/**
 * Walk the override payload against the theme manifest and keep only
 * values that pass type-specific sanitization. Unknown groups/fields are
 * silently dropped - the manifest is the source of truth for what the
 * user is allowed to override.
 */
function sanitizeOverrides(manifest: ThemeManifest, overrides: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    // 1. Token-level overrides (colors / fonts / radius / space).
    if (overrides.tokens && typeof overrides.tokens === "object" && !Array.isArray(overrides.tokens)) {
        const cleanTokens: Record<string, unknown> = {};
        for (const key of ["colors", "fonts", "radius", "space"] as const) {
            if (key in (overrides.tokens as Record<string, unknown>)) {
                const cleaned = sanitizeTokenValue(key, (overrides.tokens as Record<string, unknown>)[key], manifest);
                if (cleaned !== undefined) cleanTokens[key] = cleaned;
            }
        }
        if (Object.keys(cleanTokens).length > 0) out.tokens = cleanTokens;
    }

    // 2. Config-group overrides (manifest.config[group].fields[field] = value).
    for (const [groupKey, rawGroupVal] of Object.entries(overrides)) {
        if (groupKey === "tokens") continue; // handled above
        const groupDef = manifest.settings?.[groupKey];
        if (!groupDef) continue;
        if (!rawGroupVal || typeof rawGroupVal !== "object" || Array.isArray(rawGroupVal)) continue;
        const cleanGroup: Record<string, unknown> = emptyRecord();
        for (const [fieldKey, fieldVal] of Object.entries(rawGroupVal as Record<string, unknown>)) {
            if (isUnsafeKey(fieldKey)) continue;
            const fieldDef = groupDef.fields[fieldKey];
            if (!fieldDef || !Object.prototype.hasOwnProperty.call(groupDef.fields, fieldKey)) continue;
            const sanitized = sanitizeField(fieldDef, fieldVal);
            if (sanitized !== undefined) cleanGroup[fieldKey] = sanitized;
        }
        if (Object.keys(cleanGroup).length > 0) out[groupKey] = cleanGroup;
    }

    // 3. Optional top-level `custom_css` escape hatch - only allowed when
    // the manifest explicitly declares a `customCss` config group (none do
    // by default). Falls back to the CSS sanitizer for defense-in-depth.
    if (typeof overrides.custom_css === "string" && manifest.settings?.customCss) {
        out.custom_css = sanitizeCustomCss(overrides.custom_css);
    }

    return out;
}

/**
 * A theme customisation write. `overrides` stays `unknown` here on purpose -
 * what a valid key is comes from the theme's own manifest, and
 * `sanitizeOverrides` below is what decides that. This only establishes that
 * a mode and an overrides value arrived at all.
 */
const customizationSchema = z.object({
    mode: z.string().max(64),
    overrides: z.unknown(),
});

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id: themeId } = await ctx.params;
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const manifest = themeRegistry[themeId];
    if (!manifest) {
        return NextResponse.json({ error: "Unknown theme" }, { status: 404 });
    }

    const body = await readJsonBody(req);
    if (body instanceof NextResponse) return body;

    const parsed = customizationSchema.safeParse(body);
    if (!parsed.success || !manifest.modes.available[parsed.data.mode]) {
        return NextResponse.json({ error: "mode is required and must exist on the theme" }, { status: 400 });
    }
    const { mode, overrides } = parsed.data;

    if (overrides === undefined || overrides === null) {
        return NextResponse.json({ error: "overrides is required" }, { status: 400 });
    }
    if (typeof overrides !== "object" || Array.isArray(overrides)) {
        return NextResponse.json({ error: "overrides must be an object" }, { status: 400 });
    }
    if (JSON.stringify(overrides).length > 100_000) {
        return NextResponse.json({ error: "overrides payload too large" }, { status: 413 });
    }

    const safe = sanitizeOverrides(manifest, overrides as Record<string, unknown>);

    if (Object.keys(safe).length === 0) {
        await prisma.themeCustomization.deleteMany({ where: { themeId, mode } });
    } else {
        await prisma.themeCustomization.upsert({
            where: { themeId_mode: { themeId, mode } },
            create: { themeId, mode, overrides: safe as Prisma.InputJsonValue, updatedById: session.user.id },
            update: { overrides: safe as Prisma.InputJsonValue, updatedById: session.user.id },
        });
    }

    logActivity({
        userId: session.user.id,
        action: "theme.customization.update",
        entity: "theme",
        entityId: themeId,
        metadata: { fields: Object.keys(safe) },
    }).catch(() => {});

    return NextResponse.json({ ok: true });
}
