import { describe, it, expect } from "vitest";
import { themeManifestSchema } from "@/core/lib/theme-manifest-schema";

const minimal = {
    schemaVersion: 2,
    id: "demo",
    name: "Demo",
    description: "d",
    version: "1.0.0",
    modes: { default: "light", available: { light: { tokens: { colors: { primary: "#000" } } } } },
    tokens: { colors: { primary: { type: "color" } } },
};

describe("themeManifestSchema v2", () => {
    it("accepts the minimal valid shape", () => {
        const res = themeManifestSchema.safeParse(minimal);
        expect(res.success).toBe(true);
    });

    it("rejects schemaVersion !== 2", () => {
        const res = themeManifestSchema.safeParse({ ...minimal, schemaVersion: 1 });
        expect(res.success).toBe(false);
    });

    it("rejects when modes.default isn't in modes.available", () => {
        const res = themeManifestSchema.safeParse({
            ...minimal,
            modes: { default: "dark", available: { light: { tokens: { colors: {} } } } },
        });
        expect(res.success).toBe(false);
    });

    it("rejects when modes.available is empty", () => {
        const res = themeManifestSchema.safeParse({ ...minimal, modes: { default: "light", available: {} } });
        expect(res.success).toBe(false);
    });

    it("accepts settings.*.fields with known field types", () => {
        const res = themeManifestSchema.safeParse({
            ...minimal,
            settings: {
                hero: {
                    label: "Hero",
                    icon: "Image",
                    fields: {
                        title: { type: "text", label: "Title", default: "Hi" },
                        bg:    { type: "image", label: "BG" },
                        cta:   { type: "url", label: "CTA" },
                    },
                },
            },
        });
        expect(res.success).toBe(true);
    });

    it("rejects settings with an unknown field type", () => {
        const res = themeManifestSchema.safeParse({
            ...minimal,
            settings: {
                hero: {
                    label: "Hero", icon: "Image",
                    fields: { bad: { type: "wtf", label: "x" } as unknown },
                },
            },
        });
        expect(res.success).toBe(false);
    });

    it("lets a module's page be given only words for its heading, and never the homepage", () => {
        const words = { heading: { kicker: "kite.storeKicker", title: "Pazar yeri" } };
        expect(themeManifestSchema.safeParse({ ...minimal, layouts: { "store.home": words } }).success).toBe(true);
        expect(themeManifestSchema.safeParse({ ...minimal, layouts: { home: words } }).success).toBe(false);
        expect(themeManifestSchema.safeParse({ ...minimal, layouts: { "store.home": { heading: { subtitle: "x" } } } }).success).toBe(false);
    });

    it("accepts suggestedModules", () => {
        const res = themeManifestSchema.safeParse({
            ...minimal,
            suggestedModules: [{ id: "mc-stats", reason: "live status" }],
        });
        expect(res.success).toBe(true);
    });

    it("rejects adminRoutes with traversal", () => {
        const res = themeManifestSchema.safeParse({
            ...minimal,
            adminRoutes: [{ path: "/theme/../admin", component: "admin/a.tsx" }],
        });
        expect(res.success).toBe(false);
    });
});
