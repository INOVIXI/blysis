import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { STAFF_ROLE_PRIORITY } from "@/core/lib/constants";

/**
 * Roles are the admin's to create, rename, recolour and reorder. Every screen
 * at /admin/roles says so. Three places in the code did not believe it.
 *
 * `isStaff` measured two different things depending on which half ran: the
 * fast path accepted the role *name* "moderator" straight off the session,
 * the slow path asked whether the role's priority reached fifty. Demoting the
 * moderator role therefore removed the staff links from the navbar, which
 * reads the priority, and left the endpoints behind them answering yes.
 *
 * The maintenance screen offered checkboxes for "admin", "moderator" and
 * "member" whether or not the site had those roles, and never for one it had
 * added. The users list painted a role red or purple by name and ignored the
 * colour the admin had chosen for it.
 *
 * This gate holds the rule: a role's name decides nothing except "admin",
 * which is the one reserved name in the schema.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/**
 * What isStaff answers - not by a name, by priority from the session or the
 * database - is permissions.test.ts. This holds the number it compares
 * against to one place.
 */
describe("what counts as staff", () => {
    const permissions = read("src/core/lib/permissions.ts");

    it("is one number, named once", () => {
        expect(permissions).toContain("STAFF_ROLE_PRIORITY");
        expect(permissions).not.toMatch(new RegExp(`>=\\s*${STAFF_ROLE_PRIORITY}\\b`));
    });

    it("is measured the same way everywhere", () => {
        // The navbar and the homepage both decide whether to show staff links.
        for (const file of ["src/core/components/layout/NavbarActions.tsx", "src/app/[locale]/HomeWelcome.tsx"]) {
            const src = read(file);
            expect(src, file).toContain("STAFF_ROLE_PRIORITY");
            expect(src, file).not.toMatch(/rolePriority\s*\?\?\s*0\)\s*>=\s*50/);
        }
    });

    it("is asked with the priority at every call site", () => {
        const callers = ["src/app/api/v1/warnings/route.ts", "src/app/api/v1/warnings/[id]/route.ts"];
        for (const file of callers) {
            const src = read(file);
            const calls = src.match(/isStaff\([^)]*\)/g) ?? [];
            expect(calls.length, file).toBeGreaterThan(0);
            for (const call of calls) {
                expect(call, `${file}: ${call}`).toContain("rolePriority");
            }
        }
    });
});

describe("screens that list roles", () => {
    it("asks the site which roles it has, rather than naming three", () => {
        const src = read("src/app/[locale]/(admin)/admin/settings/maintenance/page.tsx");
        expect(src).not.toContain('["admin", "moderator", "member"]');
        expect(src).toContain('fetch("/api/v1/roles")');
        // "admin" survives a failed query, because the gate falls back to it
        expect(src).toContain('const FALLBACK_ROLE_OPTIONS = ["admin"];');
        // and a saved name that matches no current role stays on screen
        expect(src).toContain("[...new Set([...roleOptions, ...allowedRoles])]");
    });

    it("uses the colour the admin picked, not one keyed off the name", () => {
        const src = read("src/app/[locale]/(admin)/admin/users/role-select.tsx");
        expect(src).not.toContain('currentRole?.name === "admin"');
        expect(src).not.toContain('currentRole?.name === "moderator"');
        expect(src).toContain("currentRole?.color");
        // and the colour actually reaches the component
        expect(read("src/app/[locale]/(admin)/admin/users/page.tsx")).toContain("color: r.color");
    });

    it("does not tell the admin about roles in an untranslated sentence", () => {
        const src = read("src/app/[locale]/(admin)/admin/settings/maintenance/page.tsx");
        expect(src).not.toContain("Users with these roles can still browse");
        expect(src).toContain('t("maintenance_allowedRolesHint")');
        for (const locale of ["en", "tr"]) {
            const messages = JSON.parse(read(`messages-core/${locale}.json`));
            expect(messages.admin?.maintenance_allowedRolesHint, locale).toBeTruthy();
        }
    });
});

describe("the one reserved name", () => {
    it("is only ever admin", () => {
        // Everything else keys off priority, permissions or the role id. A new
        // literal role name in an authorization path is what this catches.
        const files = [
            "src/core/lib/permissions.ts",
            "src/core/lib/auth.ts",
            "src/proxy.ts",
        ];
        let seen = 0;
        for (const file of files) {
            // Either quote, either side of the comparison.
            const names = [
                ...read(file).matchAll(
                    /(?:role\??\.?name|sessionRole)\s*[=!]==?\s*["'`](\w+)["'`]|["'`](\w+)["'`]\s*[=!]==?\s*(?:\w+\??\.)*(?:role\??\.?name|sessionRole)\b/g,
                ),
            ].map((m) => m[1] ?? m[2]);
            expect([...new Set(names)].filter((n) => n !== "admin"), file).toEqual([]);
            seen += names.length;
        }
        // The admin checks themselves are comparisons the scan must see.
        expect(seen).toBeGreaterThan(0);
    });
});
