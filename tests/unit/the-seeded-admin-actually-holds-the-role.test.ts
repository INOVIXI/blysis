// @vitest-environment node
/**
 * The account the seed makes can open the panel it was made for.
 *
 * Since `001_a_member_holds_a_set_of_roles`, a member's roles are the rows in
 * `UserRole` and `User.roleId` is only the one shown beside their name -
 * "keeps its column and loses its meaning", in that migration's own words.
 * Every reader of permissions asks `UserRole`: `resolveRoles`, and through it
 * `isAdmin`, `hasPermission` and the panel.
 *
 * `prisma/seed.ts` sets `roleId` and writes no row. So the administrator a
 * fresh installation is handed holds no roles at all: signing in works, and
 * `/admin` sends them back to the home page. The migration is what back-fills
 * that row on a site being upgraded, and a database created by `prisma db
 * push` never runs it - which is how CI creates the one the end-to-end suite
 * drives, and why every spec that opens a panel screen failed on a heading
 * that was never going to render.
 *
 * Read as text rather than by running the seed, because running it needs a
 * database and this has to fail on a laptop.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SEED = fs.readFileSync(path.join(process.cwd(), "prisma/seed.ts"), "utf8");

describe("the administrator the seed creates", () => {
    it("is given the role as a row, not only as a name beside their own", () => {
        expect(SEED).toMatch(/userRole\.(create|upsert|createMany)/);
    });

    it("is still given the displayed role, which is a different column", () => {
        expect(SEED).toContain("roleId: adminRole.id");
    });

    it("writes that row in a way a second run can survive", () => {
        // The seed is run again on every deploy of some installations, and
        // `UserRole` has a unique pair: a bare `create` would throw the
        // second time and take the rest of the seed with it.
        const write = SEED.match(/userRole\.(create|upsert|createMany)/)?.[1];
        expect(["upsert", "createMany"]).toContain(write);
    });
});
