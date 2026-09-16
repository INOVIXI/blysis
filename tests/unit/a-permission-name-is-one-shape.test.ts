// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CORE_PERMISSIONS, isPermissionName, permissionModule } from "@/core/lib/permission-names";

/**
 * A permission name is one shape, and the shape is checkable.
 *
 * There were two vocabularies for one idea. A role carried named flags like
 * `blog.manage`, and a separate table carried a resource and an action -
 * `blog.article` plus `edit` - resolved by different code and edited on
 * different screens. An operator had to learn both to discover that neither
 * was enforced.
 *
 * One name now: `namespace.action`, lowercase, the namespace being the module
 * that owns it or `admin` for core's own panel. An entity-level exception is
 * the same name with an id beside it, not a second language.
 *
 * Measured before writing this: all 35 names declared across core and the 90
 * module manifests already have this shape, so the rule describes the
 * codebase rather than asking it to move.
 */

const ROOT = process.cwd();

function declaredByModules(): { module: string; name: string }[] {
    const dir = path.join(ROOT, "module-sources");
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
            const file = path.join(dir, entry.name, "module.json");
            if (!fs.existsSync(file)) return [];
            const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as {
                permissions?: { name: string; labelKey: string }[];
            };
            return (manifest.permissions ?? []).map((permission) => ({
                module: entry.name,
                name: permission.name,
            }));
        });
}

const DECLARED = declaredByModules();

describe("a permission name", () => {
    it("finds the declarations, so a broken scan cannot pass quietly", () => {
        expect(DECLARED.length).toBeGreaterThan(25);
        expect(CORE_PERMISSIONS.length).toBeGreaterThan(3);
    });

    it("is namespace and action, in lower case", () => {
        expect(isPermissionName("store.manage")).toBe(true);
        expect(isPermissionName("custom-forms.manage")).toBe(true);
        expect(isPermissionName("admin.access")).toBe(true);
    });

    it("is not a bare word, a shout, or a sentence", () => {
        for (const rejected of [
            "store",           // no action: nothing to grant
            "Store.manage",    // a name is compared as text, so case is not free
            "store.",          // an action nobody named
            ".manage",         // an action belonging to nobody
            "store manage",    // a space means somebody wrote prose into a key
            "store..manage",   // an empty segment
            "store.manage ",   // trailing space, which a settings form will produce
            "",
        ]) {
            expect(isPermissionName(rejected), `${JSON.stringify(rejected)} should be refused`).toBe(false);
        }
    });

    it("is the shape every name already declared has", () => {
        const malformed = [...CORE_PERMISSIONS, ...DECLARED.map((d) => d.name)]
            .filter((name) => !isPermissionName(name))
            .sort();
        expect(malformed).toEqual([]);
    });

    it("is declared once, by one owner", () => {
        const owners = new Map<string, string[]>();
        for (const { module, name } of DECLARED) {
            owners.set(name, [...(owners.get(name) ?? []), module]);
        }
        const shared = [...owners.entries()]
            .filter(([, modules]) => modules.length > 1)
            .map(([name, modules]) => `${name}: ${modules.join(", ")}`)
            .sort();
        expect(shared, "two modules granting the same name is two answers to one question").toEqual([]);
    });

    it("says which module a name belongs to", () => {
        expect(permissionModule("custom-forms.manage")).toBe("custom-forms");
        expect(permissionModule("admin.users")).toBe("admin");
    });
});
