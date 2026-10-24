import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * An operator's arrangement of a page is kept for each theme.
 *
 * A theme's default arrangement means something only while switching theme
 * shows that theme's design: one arrangement for the whole site would make
 * every theme look like the last one edited. So a saved arrangement belongs
 * to a page and a theme, at most one of each pair, and survives the account
 * that saved it being deleted.
 */

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "prisma/schema.core.prisma"), "utf8");

function model(name: string): string {
    const found = new RegExp(`\\nmodel ${name} \\{([^}]*)\\}`).exec(SCHEMA);
    if (!found) throw new Error(`schema.core.prisma has no model ${name}`);
    return found[1];
}

describe("a stored page layout", () => {
    const body = model("PageLayout");

    it("is one per page and theme", () => {
        expect(body).toMatch(/@@unique\(\[page, themeId\]\)/);
        expect(body).toMatch(/\bdocument\s+Json\b/);
    });

    it("outlives the account that saved it", () => {
        expect(body).toMatch(/updatedBy\s+User\?\s+@relation\("PageLayoutUpdater",[^)]*onDelete: SetNull\)/);
        expect(body).toMatch(/@@index\(\[updatedById\]\)/);
        expect(model("User")).toMatch(/PageLayout\[\]\s+@relation\("PageLayoutUpdater"\)/);
    });
});
