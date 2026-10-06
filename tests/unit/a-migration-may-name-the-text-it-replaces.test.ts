import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { supersededChecksums } from "../../scripts/apply-migrations";

/**
 * Four migrations failed every fresh install of their module.
 *
 * `member-profiles/001`, `store/014` and `tickets/002` are each correct for
 * the older database they were written for, and each failed on a new one,
 * where the reconcile has already created the final shape before migrations
 * run: a table 002 drops later, a unique index Prisma names like the
 * constraint the guard looked for, a table whose row type shares its name
 * with the enum being dropped. Installing all thirty modules that ship demo
 * data on 0.4.2 hit all three. `store/018` was behind 014 and only surfaced
 * once 014 passed: it copied from columns the final shape no longer has.
 *
 * The runner's rule that an applied migration may not change is still right,
 * so the fix cannot be a quiet edit: an install that already ran the old text
 * would abort the module. Each fixed file names the checksum of the text it
 * replaces instead, and only those are accepted.
 */

describe("the checksums a migration says it replaces", () => {
    const old = "a".repeat(64);

    it("are read from supersedes-checksum comment lines", () => {
        const sql = `-- supersedes-checksum: ${old}\n-- supersedes-checksum: ${"b".repeat(64)}\nSELECT 1;\n`;
        expect([...supersededChecksums(sql)]).toEqual([old, "b".repeat(64)]);
    });

    it("are none for a migration that names none", () => {
        expect(supersededChecksums("SELECT 1;\n").size).toBe(0);
    });

    it("ignore anything that is not a whole sha256 on its own comment line", () => {
        const sql = [
            `-- supersedes-checksum: ${old.slice(1)}`,
            `-- supersedes-checksum: ${old.toUpperCase()}`,
            `SELECT '-- supersedes-checksum: ${old}';`,
            `-- supersedes-checksum: ${old} and more`,
        ].join("\n");
        expect(supersededChecksums(sql).size).toBe(0);
    });
});

describe("the migrations fixed for fresh installs", () => {
    const fixed = [
        "module-sources/member-profiles/migrations/001_a_linked_game_account_names_no_game.sql",
        "module-sources/store/migrations/014_an_order_has_a_number_an_integrator_can_hold.sql",
        "module-sources/tickets/migrations/002_a_ticket_state_is_a_row.sql",
        // Found after the three above: store stopped at 014 and never reached it.
        "module-sources/store/migrations/018_a_bulk_discount_covers_a_shelf.sql",
    ];

    for (const file of fixed) {
        it(`${path.basename(path.dirname(path.dirname(file)))}: names the text it replaced, and is no longer that text`, () => {
            const content = fs.readFileSync(path.join(process.cwd(), file), "utf-8");
            const current = crypto.createHash("sha256").update(content).digest("hex");
            const replaced = supersededChecksums(content);
            expect(replaced.size).toBe(1);
            expect(replaced.has(current)).toBe(false);
        });
    }
});
