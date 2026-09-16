import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { pageSource } from "./module-page-source";

/**
 * A date column that decides when something ends has to meet a clock.
 *
 * The punishments module stored `expiresAt` on every ban. The create form
 * offered the field, the API validated it, the update endpoint let an admin
 * move it, and the table printed the duration beside it. Nothing anywhere
 * compared it to the current time. `active` was the only thing the badge, the
 * filter and the JSON answer ever looked at, and the only thing that ever
 * wrote `active` was an admin pressing Revoke - so a seven-day ban was still
 * "Active" a year later, both on the public history page and to the game
 * server polling this module to decide who may log in.
 *
 * The failure is silent by construction: an expiry that is never read looks
 * exactly like an expiry that has not arrived. So the gate is structural. If a
 * module's schema declares a field whose name says it governs a window in
 * time, some file in that module has to put it next to a comparison - a Prisma
 * `lt`/`lte`/`gt`/`gte` filter, or a `getTime()`/`<`/`>` against now.
 *
 * Scoped to module schemas. Core's own expiring rows (sessions, tokens, rate
 * limit windows) are swept by code that does not name the column beside a
 * comparison operator, and inventing exemptions for them would blunt the rule
 * where it earns its keep.
 */

const ROOT = process.cwd();
const MODULES = path.join(ROOT, "module-sources");

/** Field names that promise a window in time rather than a record of one. */
const GOVERNS_A_WINDOW = /^(scheduledAt|scheduledFor|publishAt|expiresAt|endsAt|startsAt)$/;

/**
 * A field name sitting next to a comparison. Three shapes cover what the
 * modules actually write: a Prisma range filter, a `getTime()` or `<`/`>` on a
 * property, and a bare identifier compared to the clock.
 */
const COMPARED =
    /(\w+)\s*:\s*\{\s*(?:lt|lte|gt|gte)\b|\.(\w+)(?:\.getTime\(\)|\s*[<>])|\b(\w+)\s*[<>]\s*(?:new Date|now\b|Date\.now)/g;

const DECLARES_A_DATE = /^\s*(\w+)\s+DateTime/;

function moduleIds(): string[] {
    return fs
        .readdirSync(MODULES, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
}

function timeFields(moduleId: string): string[] {
    const schema = path.join(MODULES, moduleId, "schema.prisma");
    if (!fs.existsSync(schema)) return [];
    const found = new Set<string>();
    for (const line of fs.readFileSync(schema, "utf8").split("\n")) {
        const match = DECLARES_A_DATE.exec(line);
        if (match && GOVERNS_A_WINDOW.test(match[1])) found.add(match[1]);
    }
    return [...found].sort();
}

function comparedNames(moduleId: string): Set<string> {
    const names = new Set<string>();
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry.name)) {
                const source = fs.readFileSync(full, "utf8");
                for (const match of source.matchAll(COMPARED)) {
                    for (const group of match.slice(1)) if (group) names.add(group);
                }
            }
        }
    };
    walk(path.join(MODULES, moduleId));
    return names;
}

const WITH_A_WINDOW = moduleIds()
    .map((id) => ({ id, fields: timeFields(id) }))
    .filter((m) => m.fields.length > 0);

describe("a module's own expiry is compared to the clock", () => {
    it("finds the modules that govern a window in time", () => {
        expect(WITH_A_WINDOW.length).toBeGreaterThan(0);
    });

    for (const { id, fields } of WITH_A_WINDOW) {
        it(`${id} reads every window field it stores`, () => {
            const compared = comparedNames(id);
            const unread = fields.filter((f) => !compared.has(f));
            expect(unread, `${id} stores ${unread.join(", ")} and never compares it to a clock`).toEqual([]);
        });
    }
});

describe("punishments derives its status rather than trusting a column", () => {
    const statusFile = path.join(MODULES, "punishments", "lib", "status.ts");
    const source = () => fs.readFileSync(statusFile, "utf8");

    it("keeps the three states in one place", () => {
        expect(fs.existsSync(statusFile)).toBe(true);
        for (const state of ["active", "expired", "revoked"]) {
            expect(source()).toContain(`"${state}"`);
        }
    });

    it("offers the same three states as a database filter", () => {
        expect(source()).toContain("statusWhere");
        expect(source()).toMatch(/expiresAt: \{ lte: now \}/);
    });

    it("does not decide the badge from the stored column", () => {
        const moduleRoot = path.join(MODULES, "punishments");
        for (const page of ["pages/admin/page.tsx", "pages/public/page.tsx"]) {
            // The public list moved into `components/`, so read the page with
            // the screen it renders rather than the page alone.
            expect(pageSource(path.join(moduleRoot, page), moduleRoot)).toContain("punishmentStatus(");
        }
    });

    it("answers with the derived status on the API", () => {
        const moduleRoot = path.join(MODULES, "punishments");
        const route = pageSource(path.join(moduleRoot, "api", "route.ts"), moduleRoot);
        expect(route).toContain("punishmentStatus(");
        expect(route).toContain("statusWhere(status");
    });

    it("filters and pages in the same query", () => {
        const admin = fs.readFileSync(path.join(MODULES, "punishments", "pages", "admin", "page.tsx"), "utf8");
        expect(admin).toContain('params.set("status", filter)');
        // A page filtered in the browser shows only the matches that happened
        // to land on it, under a total that counted the rest.
        expect(admin).not.toContain("usePagedRows");
    });
});
