import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GATES, OUTSIDE_VERIFY } from "../../scripts/verify";

/**
 * There is one command that runs what CI's check job runs.
 *
 * The list a contributor runs from memory is shorter than CI's check job, and
 * the difference is not academic: `check-marketplace-sync` and `npm audit` appear in neither
 * the documented list nor anybody's habit, and `test:coverage` enforces
 * per-file thresholds that plain `npm test` does not. Commits have gone red on
 * exactly that gap - five consecutive ones on the Docker job, and three in one
 * week on jobs a local run never touched.
 *
 * So the list lives in one place a person can run, and this test holds it
 * against the workflow. If CI gains a gate and `verify` does not, or the other
 * way round, the suite says so instead of a push finding out.
 *
 * Two CI jobs are deliberately outside it and named below: they need a
 * container and a browser, and a per-round local run of either is not the
 * trade this is making.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * Steps that prepare a fresh checkout rather than judge the code. A developer
 * running `verify` already has these: `npm ci` installed the tree, and
 * `src/modules` is their working install state - reseeding it from
 * `module-sources` would silently discard a module they installed to test.
 */
const CI_SETUP_ONLY = [
    "npm ci",
    "rm -rf src/modules",
    "cp -R module-sources src/modules",
    "set -euo pipefail",
];

/** Jobs that are not part of `verify`, and why. */
const CI_ONLY_COMMANDS = ["npm run test:e2e", "npx playwright install --with-deps chromium"];

/** Every `run:` command in the workflow's `check` job. */
function ciCheckCommands(): string[] {
    const workflow = fs.readFileSync(
        path.join(ROOT, ".github/workflows/build-and-test.yml"),
        "utf8",
    );
    const start = workflow.indexOf("\n  check:");
    expect(start, "the workflow should still have a check job").toBeGreaterThan(-1);
    const rest = workflow.slice(start + 3);
    const nextJob = rest.search(/^ {2}[a-z][\w-]*:$/m);
    const job = nextJob === -1 ? rest : rest.slice(0, nextJob);

    const commands: string[] = [];
    for (const match of job.matchAll(/run: (\|)?\s*\n?([\s\S]*?)(?=\n\s*- |\n\s*$|$)/g)) {
        for (const line of match[2].split("\n")) {
            const command = line.trim();
            if (!command || command.startsWith("#")) continue;
            commands.push(command);
        }
    }
    return commands;
}

function verifyScript(): string {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    return pkg.scripts?.verify ?? "";
}

/** The gate a command belongs to, ignoring how it is spelled. */
function gateOf(command: string): string | null {
    const known: [RegExp, string][] = [
        // Grouped, because `$` bound to the second alternative alone: a
        // command ending in `tsc --noEmit` matched anywhere in the string
        // while `run typecheck` only matched at the end. The two halves are
        // meant to be the same question.
        [/(tsc --noEmit|run typecheck)$/, "typecheck"],
        [/typecheck:modules/, "typecheck:modules"],
        [/validate-module\.ts --all/, "validate-module"],
        [/check-marketplace-sync/, "check-marketplace-sync"],
        [/check:style/, "check:style"],
        [/run lint/, "lint"],
        [/npm audit/, "audit"],
        [/test:coverage/, "test:coverage"],
        [/run build/, "build"],
        [/merge-schemas/, "db:merge"],
        [/generate:themes/, "generate:themes"],
        [/generate-registry/, "generate:registry"],
        [/generate-openapi/, "generate:openapi"],
    ];
    for (const [pattern, name] of known) if (pattern.test(command)) return name;
    return null;
}

describe("the gate list", () => {
    it("is a script somebody can run", () => {
        expect(verifyScript(), "package.json needs a `verify` script").not.toBe("");
    });

    it("covers every gate CI's check job runs", () => {
        const covered = new Set(GATES.map((g) => g.name));
        const missing = ciCheckCommands()
            .filter((c) => !CI_SETUP_ONLY.some((s) => c.startsWith(s)))
            .filter((c) => !CI_ONLY_COMMANDS.includes(c))
            .map((c) => ({ command: c, gate: gateOf(c) }))
            .filter(({ gate }) => gate !== null && !covered.has(gate))
            .map(({ command, gate }) => `${gate} (${command})`);

        expect(
            [...new Set(missing)],
            "CI judges the code with these and `npm run verify` does not:",
        ).toEqual([]);
    });

    it("does not claim a gate CI stopped running", () => {
        const ci = new Set(
            ciCheckCommands().map(gateOf).filter((g): g is string => g !== null),
        );
        const invented = GATES.map((g) => g.name).filter((n) => !ci.has(n));
        expect(invented, "`verify` runs these and CI does not; one of the two is wrong").toEqual([]);
    });

    // CI fails on a high advisory in production dependencies and only reports
    // one in the rest of the tree. verify failed on both, so it went red on a
    // dev-only advisory with no upstream fix that CI let through, and a
    // contributor learned to read its audit failure as noise.
    it("fails on the audit CI fails on, and not on the one CI only reports", () => {
        const audit = GATES.find((g) => g.name === "audit");
        const failing = ciCheckCommands().find((c) => /^npm audit\b/.test(c) && !c.includes("||"));
        expect(failing, "CI should still have an audit that fails the job").toBeDefined();
        expect(audit?.argv.join(" ")).toBe(failing);
    });

    it("names the jobs it deliberately leaves out, with a reason", () => {
        expect(Object.keys(OUTSIDE_VERIFY).length).toBeGreaterThan(0);
        for (const reason of Object.values(OUTSIDE_VERIFY)) {
            expect(reason.length, "an exclusion needs a reason").toBeGreaterThan(20);
        }
    });
});
