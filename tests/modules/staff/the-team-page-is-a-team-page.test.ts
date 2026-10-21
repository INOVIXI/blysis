/**
 * The staff module lists the team. It does not take applications.
 *
 * It used to do both: the public page carried an application form under the
 * team, the module shipped two endpoints and an admin screen to review what
 * came in, and a StaffApplication table to hold it. Applying to join a
 * community is its own thing - it has positions, questions, review states and
 * a conversation - and it is being built as its own module. Bolted onto the
 * page that shows who the team is, it was neither.
 *
 * This is the line, written down: the module that answers "who runs this
 * place" carries nothing that answers "can I join".
 *
 * The table itself stays behind on any install that already has it. Module
 * migrations are forward-only and additive, and uninstall leaves tables on
 * purpose; dropping this one would delete applications an operator may still
 * want to read.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { relativePath } from "../../unit/source-text";

const MODULE = path.join(process.cwd(), "module-sources/staff");

function everyFile(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) everyFile(full, out);
        else out.push(relativePath(MODULE, full));
    }
    return out;
}

describe("the staff module", () => {
    const files = everyFile(MODULE);
    const manifest = JSON.parse(fs.readFileSync(path.join(MODULE, "module.json"), "utf8"));

    it("still ships the team page and the screen that manages it", () => {
        expect(files).toContain("pages/public/page.tsx");
        expect(files).toContain("pages/admin/members/page.tsx");
    });

    it("ships no file for taking an application", () => {
        expect(files.filter((f) => /application/i.test(f))).toEqual([]);
    });

    it("declares no route, endpoint or menu entry for one", () => {
        const declared = JSON.stringify({
            routes: manifest.routes, adminRoutes: manifest.adminRoutes,
            api: manifest.api, menu: manifest.menu, userDataExport: manifest.userDataExport,
        });
        expect(declared.toLowerCase()).not.toContain("application");
    });

    it("keeps no table for one", () => {
        const schema = fs.readFileSync(path.join(MODULE, "schema.prisma"), "utf8");
        expect(schema).toContain("model StaffMember");
        expect(schema).not.toContain("StaffApplication");
        expect(schema).not.toContain("staffApplications");
    });

    it("carries no word for one, in either language", () => {
        const words: string[] = [];
        for (const locale of ["en", "tr"]) {
            for (const [namespace, values] of Object.entries(manifest.translations[locale] as Record<string, Record<string, string>>)) {
                for (const key of Object.keys(values)) {
                    if (/appl(y|ication)/i.test(key)) words.push(`${locale}.${namespace}.${key}`);
                }
            }
        }
        expect(words).toEqual([]);
    });
});
