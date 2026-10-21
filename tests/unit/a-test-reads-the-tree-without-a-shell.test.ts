// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { relativePath, stripComments } from "./source-text";

/**
 * A test reads the tree with Node, not with a shell tool.
 *
 * Four gates listed files with `sh -c "ls -d ..."` and searched them with
 * `grep -rn`, inside a `try` whose `catch` returned an empty list, because
 * grep exits 1 when it matches nothing. Neither tool is on the PATH of
 * PowerShell or cmd on Windows, so there the spawn failed, the catch answered
 * "nothing found", and each gate passed having read no file at all. A gate
 * that cannot fail is worse than no gate: it reads as coverage.
 *
 * `grepTree` and `moduleSourceDirs` in source-text.ts do the same in-process.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SHELL_TOOL = /\b(?:execFileSync|execFile|execSync|exec|spawnSync|spawn)\(\s*["'`](?:sh|bash|grep|ls|find|sed|awk|cat)["'`]/g;

function testFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) testFiles(full, out);
        else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
    }
    return out;
}

describe("a test that reads the tree", () => {
    it("does it without spawning a shell tool whose failure reads as no match", () => {
        const offenders = testFiles(path.join(ROOT, "tests")).flatMap((file) =>
            [...stripComments(fs.readFileSync(file, "utf8")).matchAll(SHELL_TOOL)].map(
                (match) => `${relativePath(ROOT, file)}: ${match[0]}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
