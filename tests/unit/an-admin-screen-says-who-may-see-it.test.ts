// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CORE_PERMISSIONS, isPermissionName } from "@/core/lib/permission-names";
import { CORE_ADMIN_SCREENS, ADMIN_DISPATCHER } from "@/core/lib/admin-screens";

/**
 * Every screen in the panel says which permission opens it.
 *
 * The panel had one gate, in `admin/layout.tsx`, and it asked whether the
 * member held the role named admin. Nothing past that door asked anything, so
 * a "moderator" role with every box on the roles screen ticked could not enter
 * the panel at all, and the boxes could never be consulted. The roles screen
 * was an authorization surface that reported success without acting.
 *
 * A screen is opened by a permission now, and this file is what stops a screen
 * being added without one. Deny is the default in the enforcement that reads
 * this table, so a screen missing from it is a screen nobody but an admin can
 * reach - which is the safe direction to fail, and still a failure, so it
 * fails here first where somebody is looking.
 *
 * The module dispatcher is the one page that cannot be in the table: it
 * renders whichever module page the path names, and that module declared the
 * permission in its own manifest.
 */

const ROOT = process.cwd();
const ADMIN_DIR = path.join(ROOT, "src/app/[locale]/(admin)/admin");

/** Every admin page, as the path below `/admin` that reaches it. */
function screenPaths(dir: string, prefix = ""): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...screenPaths(full, `${prefix}/${entry.name}`));
        } else if (entry.name === "page.tsx") {
            out.push(prefix === "" ? "/" : prefix);
        }
    }
    return out;
}

const PAGES = screenPaths(ADMIN_DIR).sort();
const DECLARED = new Map(CORE_ADMIN_SCREENS.map((screen) => [screen.path, screen.permission]));

describe("an admin screen", () => {
    it("finds the panel, so a broken scan cannot pass quietly", () => {
        expect(PAGES.length).toBeGreaterThan(40);
        expect(CORE_ADMIN_SCREENS.length).toBeGreaterThan(40);
    });

    it("says which permission opens it", () => {
        const silent = PAGES.filter((page) => page !== ADMIN_DISPATCHER).filter((page) => !DECLARED.has(page));
        expect(silent, "a screen with no permission is a screen only an admin can reach").toEqual([]);
    });

    it("names a permission that exists and has the one shape", () => {
        const core = new Set<string>(CORE_PERMISSIONS);
        const wrong = CORE_ADMIN_SCREENS.filter(
            (screen) => !isPermissionName(screen.permission) || !core.has(screen.permission),
        ).map((screen) => `${screen.path}: ${screen.permission}`);
        expect(wrong, "a screen cannot be opened by a permission nobody can be granted").toEqual([]);
    });

    it("keeps no row for a screen that has gone", () => {
        const pages = new Set(PAGES);
        const stale = CORE_ADMIN_SCREENS.filter((screen) => !pages.has(screen.path)).map((screen) => screen.path);
        expect(stale).toEqual([]);
    });

    it("leaves the module dispatcher to the module that declared the page", () => {
        expect(PAGES).toContain(ADMIN_DISPATCHER);
        expect(DECLARED.has(ADMIN_DISPATCHER)).toBe(false);
    });
});
