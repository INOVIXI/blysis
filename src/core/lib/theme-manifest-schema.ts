import { z } from "zod";

const HEX = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const SAFE_MODE = /^[a-z][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ADMIN_PATH = /^\/[a-z0-9][a-z0-9/-]*$/;
const COMPONENT_PATH = /^[a-zA-Z0-9_./-]+\.(tsx|jsx|ts|js)$/;
const SLOT_NAME = /^[a-zA-Z0-9.-]+$/;
/**
 * A key into the theme's own `translations` block.
 *
 * A field carried a `label` and nothing else, so every label on every theme
 * settings screen was whatever English the theme's author typed - and the
 * hero screen read "Show hero on homepage" and "Button text" to a Turkish
 * operator with the site's own chrome in Turkish around them. The literal
 * stays, as the fallback for a theme that declares no key.
 */
const SAFE_TRANSLATION_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;

const colorDef = z.object({
    type: z.literal("color"),
    default: z.string().regex(HEX).optional(),
    group: z.string().max(64).optional(),
    label: z.string().max(100).optional(),
    labelKey: z.string().max(128).regex(SAFE_TRANSLATION_KEY).optional(),
});
const fontDef = z.object({
    type: z.literal("font"),
    default: z.string().max(100).optional(),
    options: z.array(z.string().max(100)).max(100).optional(),
    label: z.string().max(100).optional(),
    labelKey: z.string().max(128).regex(SAFE_TRANSLATION_KEY).optional(),
});
const selectDef = z.object({
    type: z.literal("select"),
    default: z.string().max(64).optional(),
    options: z.array(z.object({ value: z.string().max(64), label: z.string().max(100) })).min(1).max(100),
    label: z.string().max(100).optional(),
    labelKey: z.string().max(128).regex(SAFE_TRANSLATION_KEY).optional(),
});
const sliderDef = z.object({
    type: z.literal("slider"),
    default: z.number().optional(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
    label: z.string().max(100).optional(),
    labelKey: z.string().max(128).regex(SAFE_TRANSLATION_KEY).optional(),
});
const toggleDef = z.object({
    type: z.literal("toggle"),
    default: z.boolean().optional(),
    label: z.string().max(100).optional(),
    labelKey: z.string().max(128).regex(SAFE_TRANSLATION_KEY).optional(),
});
const textDef = z.object({
    type: z.literal("text"),
    default: z.string().max(10000).optional(),
    max: z.number().int().positive().max(10000).optional(),
    label: z.string().max(100).optional(),
    labelKey: z.string().max(128).regex(SAFE_TRANSLATION_KEY).optional(),
});
const urlDef = z.object({
    type: z.literal("url"),
    default: z.string().url().optional(),
    label: z.string().max(100).optional(),
    labelKey: z.string().max(128).regex(SAFE_TRANSLATION_KEY).optional(),
});
const richTextDef = z.object({
    type: z.literal("richtext"),
    default: z.string().max(10000).optional(),
    max: z.number().int().positive().max(10000).optional(),
    label: z.string().max(100).optional(),
    labelKey: z.string().max(128).regex(SAFE_TRANSLATION_KEY).optional(),
});
const imageDef = z.object({
    type: z.literal("image"),
    default: z.string().url().optional(),
    aspectRatio: z.string().max(20).optional(),
    maxKb: z.number().int().positive().max(10000).optional(),
    label: z.string().max(100).optional(),
    labelKey: z.string().max(128).regex(SAFE_TRANSLATION_KEY).optional(),
});
const numberDef = z.object({
    type: z.literal("number"),
    default: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    label: z.string().max(100).optional(),
    labelKey: z.string().max(128).regex(SAFE_TRANSLATION_KEY).optional(),
});

const fieldDef = z.discriminatedUnion("type", [
    colorDef, fontDef, selectDef, sliderDef, toggleDef,
    textDef, urlDef, richTextDef, imageDef, numberDef,
]);

const modeDef = z.object({
    tokens: z.object({
        colors: z.record(z.string().regex(SAFE_KEY), z.string().regex(HEX)).optional(),
        fonts:  z.record(z.string().regex(SAFE_KEY), z.string().max(100)).optional(),
        radius: z.union([z.string().max(64), z.number()]).optional(),
        space:  z.number().optional(),
    }).default({}),
});

const settingsGroup = z.object({
    label: z.string().min(1).max(100),
    labelKey: z.string().max(128).regex(SAFE_TRANSLATION_KEY).optional(),
    icon: z.string().max(64).optional(),
    order: z.number().int().optional(),
    fields: z.record(z.string().regex(SAFE_KEY), fieldDef)
        .refine(r => Object.keys(r).length > 0, "at least one field required")
        .refine(r => Object.keys(r).length <= 50, "max 50 fields per group"),
});

export const themeManifestSchema = z.object({
    schemaVersion: z.literal(2),
    id: z.string().min(1).max(64).regex(SAFE_ID),
    name: z.string().min(1).max(100),
    description: z.string().max(500),
    version: z.string().regex(SEMVER),
    author: z.string().max(100).optional(),
    preview: z.string().max(256).optional(),

    modes: z.object({
        default: z.string().regex(SAFE_MODE),
        available: z.record(z.string().regex(SAFE_MODE), modeDef)
            .refine(r => Object.keys(r).length >= 1, "at least one mode required")
            .refine(r => Object.keys(r).length <= 8, "max 8 modes"),
    }).refine(m => m.default in m.available, { message: "modes.default must be in modes.available" }),

    tokens: z.object({
        colors: z.record(z.string().regex(SAFE_KEY), colorDef).optional(),
        fonts: z.record(z.string().regex(SAFE_KEY), fontDef).optional(),
        radius: z.union([selectDef, sliderDef]).optional(),
        space: sliderDef.optional(),
    }).default({}),

    settings: z.record(z.string().regex(SAFE_KEY), settingsGroup).optional(),

    components: z.record(
        z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
        z.string().regex(COMPONENT_PATH),
    ).optional(),

    slots: z.array(z.object({
        name: z.string().min(1).max(128).regex(SLOT_NAME),
    })).max(100).optional(),

    slotContents: z.array(z.object({
        slot: z.string().min(1).max(128).regex(SLOT_NAME),
        component: z.string().regex(COMPONENT_PATH),
        order: z.number().int().optional(),
    })).max(100).optional(),

    adminNav: z.object({
        label: z.string().min(1).max(100),
        icon: z.string().max(64).optional(),
        order: z.number().int().optional(),
    }).optional(),

    adminRoutes: z.array(z.object({
        path: z.string().regex(ADMIN_PATH),
        component: z.string().regex(COMPONENT_PATH),
    })).max(50).optional(),

    suggestedModules: z.array(z.object({
        id: z.string().regex(SAFE_ID),
        reason: z.string().max(200).optional(),
    })).max(20).optional(),

    translations: z.record(
        z.string().max(10),
        z.record(z.string().max(64), z.record(z.string().max(128), z.string().max(2000))),
    ).optional(),
}).strict();

export type ThemeManifest = z.infer<typeof themeManifestSchema>;
export type ThemeFieldDef = z.infer<typeof fieldDef>;
export type ThemeModeDef = z.infer<typeof modeDef>;
export type ThemeSettingsGroup = z.infer<typeof settingsGroup>;
