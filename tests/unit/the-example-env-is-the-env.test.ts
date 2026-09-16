/**
 * `.env.example` is the only documentation an operator gets for what this
 * platform reads from its environment, and it had drifted from the code.
 *
 * Measured on 2026-09-15. Core read 22 variables the file did not mention -
 * the three that decide when an account is locked out, the one that turns the
 * breach check on, the webhook replay window, the updater's channel and
 * directory, the pool size, the site's own description, e-mail and social
 * links. An operator could not have known any of them existed.
 *
 * In the other direction it named four that nothing reads. Three were a
 * PayPal block - `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENVIRONMENT`,
 * `PAYPAL_ALLOW_UNVERIFIED` - and the module actually reads `PAYPAL_MODE`,
 * `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. So an operator following the
 * file set three variables that did nothing and never set the one that
 * mattered.
 *
 * A module's own variables are deliberately not here: they are configured in
 * Admin > Settings and sealed into the database, and core naming
 * `STRIPE_SECRET_KEY` would be core knowing a gateway exists. The file's own
 * header says so, and the PayPal block contradicted it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** Every `process.env.NAME` in a set of files. */
function reads(files: string[]): Set<string> {
    const found = new Set<string>();
    for (const file of files) {
        for (const m of fs.readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
            found.add(m[1]);
        }
    }
    return found;
}

const CORE = reads([
    ...walk(path.join(ROOT, "src/core")),
    ...walk(path.join(ROOT, "src/app")),
    ...walk(path.join(ROOT, "scripts")),
    ...walk(path.join(ROOT, "prisma")),
]);
const MODULES = reads(walk(path.join(ROOT, "module-sources")));

const EXAMPLE = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
const DOCUMENTED = new Set(
    Array.from(EXAMPLE.matchAll(/^#?\s*([A-Z_][A-Z0-9_]*)=/gm), (m) => m[1]),
);

/** Names compose and Caddy interpolate, which the app never reads itself. */
const ORCHESTRATION = new Set(
    Array.from(
        (fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8")
            + fs.readFileSync(path.join(ROOT, "Caddyfile"), "utf8")).matchAll(/\$\{?([A-Z_][A-Z0-9_]*)/g),
        (m) => m[1],
    ),
);

/**
 * Names the runtime supplies rather than the operator. Documenting these
 * would invite somebody to set them, which is the opposite of helpful.
 */
const SUPPLIED_BY_THE_RUNTIME = new Set(["NEXT_RUNTIME", "NEXT_PHASE", "CI", "VERCEL"]);

describe(".env.example", () => {
    it("finds something to compare, so a broken scan cannot pass quietly", () => {
        expect(CORE.size).toBeGreaterThan(30);
        expect(DOCUMENTED.size).toBeGreaterThan(20);
    });

    it("names every variable core reads", () => {
        const undocumented = [...CORE]
            .filter((name) => !DOCUMENTED.has(name))
            .filter((name) => !SUPPLIED_BY_THE_RUNTIME.has(name))
            // A module's own, read here only because it ships installed.
            .filter((name) => !MODULES.has(name))
            .sort();
        expect(undocumented, "an operator cannot set what nobody told them about").toEqual([]);
    });

    it("names nothing that no longer exists", () => {
        const dead = [...DOCUMENTED]
            .filter((name) => !CORE.has(name) && !MODULES.has(name) && !ORCHESTRATION.has(name))
            .sort();
        expect(dead, "a variable nothing reads is an instruction that does nothing").toEqual([]);
    });

    it("parses as the shell file it is", () => {
        for (const [index, line] of EXAMPLE.split("\n").entries()) {
            if (!line.trim() || line.trimStart().startsWith("#")) continue;
            expect(line, `line ${index + 1}`).toMatch(/^[A-Z_][A-Z0-9_]*=("([^"]*)"|[^"]*)$/);
        }
    });
});
