import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Maintenance mode is the switch that takes the whole site offline. Its
 * cache lives on globalThis specifically so the proxy bundle and the API
 * route bundle share one object - get that wrong and an admin turning
 * maintenance off watches the site stay down. It also has to fail *open*:
 * a database error must never lock visitors out.
 */

const { setting } = vi.hoisted(() => ({
    setting: { findUnique: vi.fn(), upsert: vi.fn() },
}));

vi.mock("@/core/lib/db", () => ({
    default: { setting },
    prisma: { setting },
}));

import {
    getMaintenanceConfig,
    setMaintenanceConfig,
    invalidateMaintenanceCache,
} from "@/core/lib/maintenance";

beforeEach(() => {
    setting.findUnique.mockReset().mockResolvedValue(null);
    setting.upsert.mockReset().mockResolvedValue({});
    invalidateMaintenanceCache();
});

afterEach(() => {
    vi.useRealTimers();
    invalidateMaintenanceCache();
});

describe("getMaintenanceConfig", () => {
    it("returns the disabled default when nothing is stored", async () => {
        await expect(getMaintenanceConfig()).resolves.toEqual({
            enabled: false, message: "", allowedRoles: ["admin"],
        });
    });

    it("reads the maintenance_mode setting row", async () => {
        await getMaintenanceConfig();
        expect(setting.findUnique).toHaveBeenCalledWith({ where: { key: "maintenance_mode" } });
    });

    it("returns the stored configuration", async () => {
        setting.findUnique.mockResolvedValue({
            value: { enabled: true, message: "Back soon", allowedRoles: ["admin", "staff"] },
        });

        await expect(getMaintenanceConfig()).resolves.toEqual({
            enabled: true, message: "Back soon", allowedRoles: ["admin", "staff"],
        });
    });

    it("fails open when the database is unreachable", async () => {
        setting.findUnique.mockRejectedValue(new Error("db down"));

        // Anything other than enabled:false here takes the site offline
        // precisely when it is already struggling.
        await expect(getMaintenanceConfig()).resolves.toEqual({
            enabled: false, message: "", allowedRoles: ["admin"],
        });
    });

    it("does not cache a failed read", async () => {
        setting.findUnique.mockRejectedValueOnce(new Error("db down"));
        await getMaintenanceConfig();

        setting.findUnique.mockResolvedValue({ value: { enabled: true } });
        await expect(getMaintenanceConfig()).resolves.toMatchObject({ enabled: true });
    });
});

describe("normalisation", () => {
    it("coerces a truthy enabled flag to a boolean", async () => {
        setting.findUnique.mockResolvedValue({ value: { enabled: "yes" } });
        await expect(getMaintenanceConfig()).resolves.toMatchObject({ enabled: true });
    });

    it("replaces a non-string message with an empty one", async () => {
        setting.findUnique.mockResolvedValue({ value: { enabled: true, message: 42 } });
        await expect(getMaintenanceConfig()).resolves.toMatchObject({ message: "" });
    });

    it("keeps a message written per language", async () => {
        setting.findUnique.mockResolvedValue({ value: { enabled: true, message: { default: "Bakımdayız", en: "Down for maintenance", de: "" } } });
        await expect(getMaintenanceConfig()).resolves.toMatchObject({ message: { default: "Bakımdayız", en: "Down for maintenance" } });
    });

    it("falls back to the default roles when the stored value is not an array", async () => {
        setting.findUnique.mockResolvedValue({ value: { enabled: true, allowedRoles: "admin" } });
        await expect(getMaintenanceConfig()).resolves.toMatchObject({ allowedRoles: ["admin"] });
    });

    it("drops non-string entries from the role list", async () => {
        setting.findUnique.mockResolvedValue({
            value: { enabled: true, allowedRoles: ["admin", 5, null, "staff"] },
        });
        await expect(getMaintenanceConfig()).resolves.toMatchObject({
            allowedRoles: ["admin", "staff"],
        });
    });

    it("accepts an empty role list rather than substituting the default", async () => {
        setting.findUnique.mockResolvedValue({ value: { enabled: true, allowedRoles: [] } });
        await expect(getMaintenanceConfig()).resolves.toMatchObject({ allowedRoles: [] });
    });

    it("treats a non-object stored value as the default", async () => {
        setting.findUnique.mockResolvedValue({ value: "enabled" });
        await expect(getMaintenanceConfig()).resolves.toEqual({
            enabled: false, message: "", allowedRoles: ["admin"],
        });
    });

    it("treats a null stored value as the default", async () => {
        setting.findUnique.mockResolvedValue({ value: null });
        await expect(getMaintenanceConfig()).resolves.toMatchObject({ enabled: false });
    });
});

describe("caching", () => {
    it("serves a second read from cache without touching the database", async () => {
        await getMaintenanceConfig();
        await getMaintenanceConfig();

        expect(setting.findUnique).toHaveBeenCalledTimes(1);
    });

    it("re-reads once the five-second window has passed", async () => {
        vi.useFakeTimers();
        await getMaintenanceConfig();

        vi.setSystemTime(Date.now() + 5_001);
        await getMaintenanceConfig();

        expect(setting.findUnique).toHaveBeenCalledTimes(2);
    });

    it("still serves from cache just inside the window", async () => {
        vi.useFakeTimers();
        await getMaintenanceConfig();

        vi.setSystemTime(Date.now() + 4_999);
        await getMaintenanceConfig();

        expect(setting.findUnique).toHaveBeenCalledTimes(1);
    });

    it("shares one cache object across bundles via globalThis", async () => {
        await getMaintenanceConfig();

        // This is the key the proxy bundle reads; if it moves, the two
        // bundles silently stop sharing state.
        const g = globalThis as unknown as Record<string, unknown>;
        expect(g["__blysis_maintenance_cache__"]).toBeDefined();
    });

    it("is dropped by invalidateMaintenanceCache", async () => {
        await getMaintenanceConfig();
        invalidateMaintenanceCache();
        await getMaintenanceConfig();

        expect(setting.findUnique).toHaveBeenCalledTimes(2);
    });
});

describe("setMaintenanceConfig", () => {
    it("upserts the normalised value under the maintenance key", async () => {
        await setMaintenanceConfig({ enabled: true, message: "brb", allowedRoles: ["admin"] });

        const args = setting.upsert.mock.calls[0]![0];
        expect(args.where).toEqual({ key: "maintenance_mode" });
        expect(args.update.value).toEqual({ enabled: true, message: "brb", allowedRoles: ["admin"] });
        expect(args.create).toEqual({
            key: "maintenance_mode",
            value: { enabled: true, message: "brb", allowedRoles: ["admin"] },
            module: "core",
        });
    });

    it("normalises before writing", async () => {
        await setMaintenanceConfig({
            enabled: true,
            allowedRoles: ["admin", 7 as unknown as string],
        });

        expect(setting.upsert.mock.calls[0]![0].update.value).toEqual({
            enabled: true, message: "", allowedRoles: ["admin"],
        });
    });

    it("primes the cache so the next read sees the new state immediately", async () => {
        await setMaintenanceConfig({ enabled: true, message: "brb" });

        await expect(getMaintenanceConfig()).resolves.toMatchObject({ enabled: true });
        expect(setting.findUnique).not.toHaveBeenCalled();
    });
});
