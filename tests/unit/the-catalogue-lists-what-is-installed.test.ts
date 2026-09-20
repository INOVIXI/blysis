// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What the roles screen is offered, and by whom.
 *
 * Core's own names come first, in sections, because the panel is not a module.
 * A module's come from its manifest with the key to its own words, so core
 * carries no wording for a module and a fork that ships different ones gets
 * its own.
 *
 * The enabled set is handed in rather than read from `isEnabled`, and that is
 * the defect this pins: that flag answers false until somebody calls
 * `initialize()`, which in a route handler nobody does. The screen showed
 * core's twelve on an installation running ninety modules.
 *
 * Absent means nobody ruled on it, which the rest of the product reads as
 * enabled. Only an explicit false takes a module's names off the screen: a
 * permission for screens that answer 404 is a row an operator cannot act on.
 */

const moduleLoader = { getModules: vi.fn(), getModule: vi.fn() };
vi.mock("@/core/lib/module-loader", () => ({ moduleLoader }));

const { moduleSystem } = await import("@/core/lib/modules");
const { CORE_PERMISSION_CATALOGUE } = await import("@/core/lib/permission-names");

function installed(...manifests: { id: string; permissions?: { name: string; labelKey: string }[] }[]) {
    moduleLoader.getModules.mockReturnValue(manifests.map((manifest) => ({ manifest })));
    moduleLoader.getModule.mockImplementation((id: string) => {
        const found = manifests.find((m) => m.id === id);
        return found ? { manifest: found } : undefined;
    });
}

/** A module state row, as the database hands it over. */
function state(id: string, enabled: boolean) {
    return { id, enabled, config: {} } as unknown as Parameters<typeof moduleSystem.initialize>[0][number];
}

beforeEach(() => vi.clearAllMocks());

describe("the permission catalogue", () => {
    it("starts with core's own, each under a section", () => {
        installed();
        const entries = moduleSystem.permissionCatalogue({});

        expect(entries.length).toBe(CORE_PERMISSION_CATALOGUE.length);
        expect(entries.every((entry) => entry.namespace === "core")).toBe(true);
        expect(new Set(entries.map((entry) => entry.section))).toEqual(
            new Set(["panel", "people", "content", "system"]),
        );
    });

    it("adds a module's names, pointed at that module's own words", () => {
        installed({ id: "shop", permissions: [{ name: "shop.manage", labelKey: "shop.perm_manage" }] });

        const shop = moduleSystem.permissionCatalogue({}).filter((entry) => entry.namespace === "shop");

        expect(shop).toEqual([
            { name: "shop.manage", labelKey: "shop.perm_manage", namespace: "shop", section: "shop" },
        ]);
    });

    it("lists a module nobody has ruled on", () => {
        // Absent is not off. The rest of the product treats an unlisted module
        // as enabled, and a catalogue that disagreed would hide the permissions
        // of every module on a fresh install.
        installed({ id: "shop", permissions: [{ name: "shop.manage", labelKey: "shop.perm_manage" }] });
        expect(moduleSystem.permissionCatalogue({}).some((e) => e.namespace === "shop")).toBe(true);
    });

    it("leaves out a module that was turned off", () => {
        installed({ id: "shop", permissions: [{ name: "shop.manage", labelKey: "shop.perm_manage" }] });
        const entries = moduleSystem.permissionCatalogue({ shop: false });
        expect(entries.some((entry) => entry.namespace === "shop")).toBe(false);
        expect(entries.length).toBe(CORE_PERMISSION_CATALOGUE.length);
    });

    it("tolerates a module that declares none", () => {
        installed({ id: "quiet" });
        expect(moduleSystem.permissionCatalogue({}).length).toBe(CORE_PERMISSION_CATALOGUE.length);
    });
});

describe("the names alone", () => {
    it("are core's plus every enabled module's", async () => {
        installed({ id: "shop", permissions: [{ name: "shop.manage", labelKey: "shop.perm_manage" }] });
        await moduleSystem.initialize([state("shop", true)]);
        expect(moduleSystem.getAllPermissions()).toContain("shop.manage");
    });

    it("leave out a module that is off", async () => {
        installed({ id: "shop", permissions: [{ name: "shop.manage", labelKey: "shop.perm_manage" }] });
        await moduleSystem.initialize([state("shop", false)]);
        expect(moduleSystem.getAllPermissions()).not.toContain("shop.manage");
    });
});

describe("asking about one module", () => {
    it("hands back the manifest it was given", () => {
        installed({ id: "shop" });
        expect(moduleSystem.getDefinition("shop")?.id).toBe("shop");
    });

    it("says nothing about a module that is not installed", () => {
        installed({ id: "shop" });
        expect(moduleSystem.getDefinition("there-is-no-such-module")).toBeUndefined();
    });

    it("is enabled once a row says so, and not when the row says otherwise", async () => {
        installed({ id: "shop" }, { id: "quiet" });
        await moduleSystem.initialize([state("shop", true), state("quiet", false)]);
        expect(moduleSystem.isEnabled("shop")).toBe(true);
        expect(moduleSystem.isEnabled("quiet")).toBe(false);
        // A module with no row at all: the flag is about what the database
        // said, and it said nothing.
        expect(moduleSystem.isEnabled("absent")).toBe(false);
        expect(moduleSystem.getEnabledModules().map((m) => m.id)).toEqual(["shop"]);
    });

    it("is not enabled before anything has been initialised", async () => {
        // The defect the catalogue works around: this answers false until
        // `initialize()` has run, and in a route handler nothing runs it.
        installed({ id: "shop" });
        await moduleSystem.initialize([]);
        expect(moduleSystem.isEnabled("shop")).toBe(false);
    });
});
