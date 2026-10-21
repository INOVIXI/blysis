/**
 * Run what CI's check job runs, in one command.
 *
 * The list a contributor is likely to run from memory is shorter than the one
 * CI runs, and the difference has cost real commits: `check-marketplace-sync` and `npm audit` are in
 * nobody's habit, and `test:coverage` enforces per-file thresholds that plain
 * `npm test` leaves as decoration. A push is a slow way to find that out.
 *
 * It runs every gate rather than stopping at the first failure, because the
 * question at the end of a change is "what is broken", not "what broke first".
 *
 * Two things it deliberately does not do:
 *
 *   - It does not reseed `src/modules` from `module-sources` the way CI does.
 *     On a fresh checkout that directory is empty and CI has to fill it; on a
 *     developer's machine it is their install state, and overwriting it would
 *     discard a module they installed to test against.
 *   - It builds into `.next-prod`, not `.next`, so a dev server on 3001 keeps
 *     its cache and keeps serving. Next writes its own directory into
 *     `tsconfig.json` on the way through, so that file is put back afterwards.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { toolCommand } from "../src/core/lib/tool-command";

const ROOT = path.resolve(import.meta.dirname, "..");
const TSCONFIG = path.join(ROOT, "tsconfig.json");

export interface Gate {
    /** What it is called in the summary, and what the guard test matches on. */
    name: string;
    /** Argv as it would be typed; started through `toolCommand`, without a shell. */
    argv: string[];
    env?: Record<string, string>;
}

/**
 * In CI's order. Preparation first: a type check against a stale Prisma client
 * or a stale registry answers a question about yesterday's tree.
 */
export const GATES: Gate[] = [
    { name: "db:merge", argv: ["npx", "tsx", "scripts/merge-schemas.ts"] },
    { name: "generate:themes", argv: ["npm", "run", "generate:themes"] },
    { name: "generate:registry", argv: ["npx", "tsx", "scripts/generate-registry.ts"] },
    { name: "generate:openapi", argv: ["npx", "tsx", "scripts/generate-openapi.ts"] },
    { name: "typecheck", argv: ["npx", "tsc", "--noEmit"] },
    { name: "typecheck:modules", argv: ["npm", "run", "typecheck:modules"] },
    { name: "validate-module", argv: ["npx", "tsx", "scripts/validate-module.ts", "--all"] },
    { name: "check-marketplace-sync", argv: ["npx", "tsx", "scripts/check-marketplace-sync.ts"] },
    { name: "check:style", argv: ["npm", "run", "check:style"] },
    // The separator matters: without it npm keeps the flag for itself.
    { name: "lint", argv: ["npm", "run", "lint", "--", "--max-warnings=0"] },
    { name: "audit", argv: ["npm", "audit", "--omit=dev", "--audit-level=high"] },
    { name: "test:coverage", argv: ["npm", "run", "test:coverage"] },
    { name: "build", argv: ["npm", "run", "build"], env: { NEXT_DIST_DIR: ".next-prod" } },
];

/** CI jobs this does not run, and why. */
export const OUTSIDE_VERIFY: Record<string, string> = {
    "End-to-end (Playwright)":
        "needs a browser and a served build; run `npm run test:e2e` directly when a change touches the interface",
    "Docker image + module lifecycle smoke test":
        "builds an image and installs a module into an empty volume; run it when the Dockerfile or a migration changes",
};

function run(gate: Gate): number {
    const started = Date.now();
    const result = spawnSync(...toolCommand(gate.argv, ROOT), {
        cwd: ROOT,
        stdio: "inherit",
        env: { ...process.env, ...gate.env },
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const code = result.status ?? 1;
    console.log(`\n[verify] ${gate.name}: exit ${code} (${seconds}s)\n`);
    return code;
}

function main(): void {
    const tsconfigBefore = fs.readFileSync(TSCONFIG, "utf8");
    const results: { name: string; code: number }[] = [];

    for (const gate of GATES) {
        results.push({ name: gate.name, code: run(gate) });
    }

    // `next build` adds its own dist directory to the include list.
    if (fs.readFileSync(TSCONFIG, "utf8") !== tsconfigBefore) {
        fs.writeFileSync(TSCONFIG, tsconfigBefore);
        console.log("[verify] tsconfig.json put back the way the build found it");
    }

    console.log("\n=== verify ===");
    for (const { name, code } of results) {
        console.log(`  ${code === 0 ? "ok  " : "FAIL"}  ${name}`);
    }
    const failed = results.filter((r) => r.code !== 0);
    console.log(`\n  ${results.length - failed.length}/${results.length} gates passed`);
    for (const [job, why] of Object.entries(OUTSIDE_VERIFY)) {
        console.log(`  not run here: ${job} - ${why}`);
    }
    process.exit(failed.length === 0 ? 0 : 1);
}

/**
 * Only when run, never when imported. The guard test reads `GATES` to hold it
 * against the workflow, and an unguarded `main()` here meant importing this
 * file ran every gate - the test spent its first attempt building the app.
 */
const invokedDirectly = process.argv[1]?.endsWith("verify.ts") ?? false;
if (invokedDirectly) main();
