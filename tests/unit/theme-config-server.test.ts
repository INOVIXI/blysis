import { describe, it, expect, vi } from "vitest";

const mockCustomization = { mode: "light", overrides: { hero: { headline: "custom" } } };

vi.mock("@/core/lib/db", () => ({
    prisma: {
        themeState: { findFirst: vi.fn(async () => ({ themeId: "flat", mode: "light" })) },
        // Every mode's row, so the page can carry each mode's colours.
        themeCustomization: { findMany: vi.fn(async () => [mockCustomization]) },
        setting: { findUnique: vi.fn(async () => null) },
        themeSetting: { findMany: vi.fn(async () => []) },
    },
}));

vi.mock("@/core/generated/theme-registry", () => ({
    themeRegistry: {
        flat: {
            schemaVersion: 1 as const,
            id: "flat",
            name: "Flat",
            description: "",
            version: "1.0.0",
            type: "light" as const,
            modes: { default: "light", available: { light: {} } },
            tokens: {},
            config: {
                hero: {
                    label: "Hero",
                    fields: {
                        headline: { type: "text", default: "default" },
                        enabled:  { type: "toggle", default: true },
                    },
                },
            },
        },
    },
    themeIds: ["flat"] as const,
    defaultThemeId: "flat",
}));

describe("getActiveTheme (server)", () => {
    it("returns tokenOverrides from customization", async () => {
        const { getActiveTheme } = await import("@/core/lib/theme-state");
        const { tokenOverrides } = await getActiveTheme();
        expect((tokenOverrides as { hero?: { headline?: string } }).hero?.headline).toBe("custom");
    });
});
