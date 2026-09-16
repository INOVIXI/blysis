// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { migrationOwners, migrationsDirFor, CORE_MIGRATION_OWNER } from "@/../scripts/apply-migrations";

/**
 * Core's own schema moves by migration, like a module's.
 *
 * The runner walked installed modules and nothing else, so a change to a core
 * table had exactly two ways to reach a database: `prisma db push`, which the
 * running app must never do because it reconciles the whole schema and would
 * drop the tables an uninstalled module deliberately left behind, or the
 * additive sync, which by design refuses anything that is not a pure
 * `CreateTable`.
 *
 * That left no way at all to move data from an old shape to a new one - which
 * is exactly what multiple roles per member needs: a new table, filled from
 * two old ones, and one of those dropped afterwards.
 *
 * Core runs first. A module's migration may reasonably read a core table; a
 * core migration may not read a module's, because the module may not be
 * installed.
 */

const ROOT = process.cwd();

describe("the migration runner", () => {
    it("knows core as an owner of migrations", () => {
        expect(migrationOwners()).toContain(CORE_MIGRATION_OWNER);
    });

    it("runs core before any module", () => {
        expect(migrationOwners()[0]).toBe(CORE_MIGRATION_OWNER);
    });

    it("reads core's migrations from prisma/migrations", () => {
        expect(migrationsDirFor(CORE_MIGRATION_OWNER)).toBe(path.join(ROOT, "prisma/migrations"));
    });

    it("still finds a module's own", () => {
        const dir = migrationsDirFor("store");
        expect(dir).not.toBeNull();
        expect(dir).toMatch(/store\/migrations$/);
    });

    it("says nothing for a module that has none", () => {
        expect(migrationsDirFor("there-is-no-such-module")).toBeNull();
    });
});
