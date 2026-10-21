// @vitest-environment node
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * A checkout has the line endings the repository has, on every platform.
 *
 * Every text file is committed with LF. Git for Windows installs with
 * `core.autocrlf=true`, which rewrites each of them to CRLF on checkout, so
 * on a Windows machine the working tree stopped being the repository:
 * `check-marketplace-sync` compares `module-sources/` with the published ZIPs
 * byte for byte and failed on every module, and a marketplace build run there
 * would have packed CRLF into archives the rest of the world unpacks.
 *
 * `.gitattributes` pins `eol=lf` for every text file, which takes precedence
 * over whatever `core.autocrlf` a contributor's machine has. This reads what
 * git itself reports for the working tree, so it fails on the machine that
 * would have produced the drift rather than in CI, which never checks out on
 * Windows.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

function workingTreeEndings(): { file: string; endings: string }[] {
    const result = spawnSync("git", ["ls-files", "--eol", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
    return result.stdout
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
            const [info, file] = entry.split("\t");
            return { file, endings: info.split(/\s+/)[1] ?? "" };
        });
}

describe("a checkout", () => {
    it("writes every tracked text file with LF", () => {
        const drifted = workingTreeEndings()
            .filter(({ endings }) => endings === "w/crlf" || endings === "w/mixed")
            .map(({ file, endings }) => `${file} (${endings.slice(2)})`);

        expect(drifted).toEqual([]);
    });
});
