import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { relativePath } from "./source-text";

/**
 * A form that sends nine values is one save, not nine.
 *
 * Four endpoints wrote a loop of `await prisma.<model>.upsert(...)`. The site
 * settings form sends nine keys and the general settings form sends more, so
 * a connection that dropped on the fifth left four of them written and
 * answered with a message that said the save had failed - and the operator,
 * being told nothing was saved, has no reason to go and look at what was.
 * The module screen's cascade-disable was worse: stopping halfway left some
 * dependents disabled and the module they depend on still enabled, which is
 * precisely the state that branch exists to prevent.
 *
 * Prisma takes an array of operations and runs them in one transaction, which
 * is also one round trip instead of N. This gate keeps the loops from coming
 * back.
 *
 * Scope is deliberately narrow: a write inside a loop over a *request body*,
 * which is what these were. A loop over rows the server itself produced - a
 * migration, a seed, a backfill that must survive partial progress - is a
 * different thing and lives in scripts/, which is not searched.
 */

const ROOT = path.resolve(__dirname, "../..");
const SEARCH = ["src/app/api", "module-sources"];

function routeFiles(dir: string, into: string[] = []): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return into;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules") continue;
            routeFiles(full, into);
        } else if (entry.name === "route.ts") {
            into.push(full);
        }
    }
    return into;
}

/** Matches from `at` to the character after the balanced closer. */
function afterBalanced(source: string, at: number, open: string, close: string): number {
    let depth = 0;
    let i = at;
    do {
        if (source[i] === open) depth++;
        else if (source[i] === close) depth--;
        i++;
    } while (i < source.length && depth > 0);
    return i;
}

/**
 * The body of every `for (...) { }` in a source.
 *
 * The header's parentheses are balanced rather than matched with `[^)]*`,
 * which stops at the first `)` and so misses the very shape this is looking
 * for: `for (const [k, v] of Object.entries(body))`.
 */
function loopBodies(source: string): string[] {
    const bodies: string[] = [];
    for (const match of source.matchAll(/\bfor\s*\(/g)) {
        const headerEnd = afterBalanced(source, match.index! + match[0].length - 1, "(", ")");
        const braceAt = source.indexOf("{", headerEnd);
        if (braceAt === -1 || source.slice(headerEnd, braceAt).trim() !== "") continue;
        const end = afterBalanced(source, braceAt, "{", "}");
        bodies.push(source.slice(braceAt + 1, end - 1));
    }
    return bodies;
}

/** A write, as opposed to a read or a count. */
const WRITE = /await\s+(?:prisma|tx)\.\w+\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;

/**
 * Loops whose writes are deliberately one at a time. Each entry is a
 * decision, not a backlog.
 */
const MAY_LOOP: Record<string, string> = {
    "src/app/api/setup/route.ts":
        "First-run setup, which is already all-or-nothing at a coarser grain: a failure leaves the install unfinished and the wizard resumes from its own state file rather than from what reached the database.",
    "src/app/api/v1/modules/marketplace/bulk-install/route.ts":
        "Installing a module writes files, applies schema additions and runs the module's own onEnable hook, none of which a database transaction can roll back. Each install stands or falls on its own and the response reports which ones did.",
};

describe("a write over a request body", () => {
    const files = SEARCH.flatMap((d) => routeFiles(path.join(ROOT, d)));

    it("finds the routes", () => {
        expect(files.length).toBeGreaterThan(100);
    });

    it("goes through one transaction rather than a loop of awaits", () => {
        const offenders: string[] = [];
        for (const file of files) {
            const relative = relativePath(ROOT, file);
            if (MAY_LOOP[relative]) continue;
            const source = fs.readFileSync(file, "utf8");
            for (const body of loopBodies(source)) {
                if (WRITE.test(body)) {
                    offenders.push(relative);
                    break;
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("names only files that exist", () => {
        for (const relative of Object.keys(MAY_LOOP)) {
            expect(fs.existsSync(path.join(ROOT, relative)), relative).toBe(true);
        }
    });

    it("still detects a loop, so the rule above is not vacuous", () => {
        const sample = `
            for (const [key, value] of Object.entries(body)) {
                await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
            }
        `;
        expect(loopBodies(sample).some((b) => WRITE.test(b))).toBe(true);
    });
});
