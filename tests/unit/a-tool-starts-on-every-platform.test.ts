// @vitest-environment node
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { toolCommand } from "@/core/lib/tool-command";
import { stripComments } from "./source-text";

/**
 * A tool the project runs starts on every platform the project runs on.
 *
 * Install, update, setup, the build reconciler, postinstall and `verify` all
 * ran `tsx`, `prisma`, `tsc` and `npm` by spawning `npx` or `npm` without a
 * shell. On Linux and macOS that finds an executable on PATH. On Windows
 * there is none to find: both are `.cmd` shims, so the spawn fails with
 * ENOENT, and naming the shim outright fails with EINVAL, because Node has
 * refused to start a batch file without a shell since the CVE-2024-27980 fix.
 * `postinstall` swallowed the failure and printed a warning, so a fresh clone
 * on Windows had no Prisma client, no registry and no merged schema, and a
 * module installed from the panel never got its codegen.
 *
 * `toolCommand` starts the tool's own script with the running Node instead,
 * which needs no shell anywhere and no quoting rules to get wrong. The spawns
 * below are real: on the Windows machine that found this, every one of them
 * failed the old way.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

function run(argv: string[]): { status: number | null; out: string } {
    const result = spawnSync(...toolCommand(argv, ROOT), { cwd: ROOT, encoding: "utf8", timeout: 15000 });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("a project tool", () => {
    it("starts through the running node, with no shell in between", () => {
        const [file] = toolCommand(["npx", "tsx", "--version"], ROOT);
        expect(file).toBe(process.execPath);

        const { status, out } = run(["npx", "tsx", "--version"]);
        expect(status).toBe(0);
        expect(out).toMatch(/tsx v\d/);
    });

    it("is found when its command and its package have different names", () => {
        const { status, out } = run(["npx", "tsc", "--version"]);
        expect(status).toBe(0);
        expect(out).toMatch(/Version \d/);
    });

    it("includes npm itself", () => {
        const { status, out } = run(["npm", "--version"]);
        expect(status).toBe(0);
        expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("passes an argument with a space in it through as one argument", () => {
        const { status, out } = run(["npx", "tsx", "-e", "console.log(JSON.stringify(process.argv.slice(1)))", "a b"]);
        expect(status).toBe(0);
        expect(JSON.parse(out.trim())).toEqual(["a b"]);
    });

    it("names a tool that is not installed instead of fetching it", () => {
        expect(() => toolCommand(["npx", "no-such-tool-anywhere"], ROOT)).toThrow(/no-such-tool-anywhere/);
    });

    it("refuses a command that is not a project tool", () => {
        expect(() => toolCommand(["git", "status"], ROOT)).toThrow(/git/);
    });
});

/**
 * The gate half. A direct `spawn("npx", ...)` works on the machine of
 * whoever writes it, as long as that machine is not running Windows, which
 * is how forty of them arrived without anyone noticing.
 *
 * The match is on the shape every spawn API shares, a command followed by
 * its argument array, so a local `run(label, "npx", [...])` wrapper is
 * caught as well as a bare `execFileSync("npx", [...])`. An argv handed to
 * `toolCommand` reads `["npx", "tsx", ...]` and does not match.
 */
const SCANNED = ["src", "scripts", "prisma"];
const DIRECT_SPAWN = /["'`](?:npx|npm)(?:\.cmd)?["'`]\s*,\s*\[/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "generated" && entry.name !== "modules") sourceFiles(full, out);
        } else if (/\.(ts|tsx|mts|mjs|js|cjs)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

describe("code that starts a project tool", () => {
    it("goes through toolCommand rather than spawning npx or npm", () => {
        const offenders = SCANNED.flatMap((dir) => sourceFiles(path.join(ROOT, dir))).flatMap((file) => {
            const code = stripComments(fs.readFileSync(file, "utf8"));
            return [...code.matchAll(DIRECT_SPAWN)].map(
                (match) => `${path.relative(ROOT, file).replaceAll("\\", "/")}: ${match[0]}`,
            );
        });

        expect(offenders).toEqual([]);
    });
});
