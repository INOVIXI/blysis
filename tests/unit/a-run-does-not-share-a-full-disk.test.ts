// @vitest-environment node
/**
 * A run writes its scratch files where this repository can see them.
 *
 * Measured on the development box on 2026-09-20: `/tmp` is a 32 GB tmpfs
 * shared with nine other projects on the same machine, and it reached zero
 * bytes free mid-run. What that produced did not look like what it was - a
 * test standing up a temp module failed with `cp: error writing ... No space
 * left on device`, Chromium died before the login form so no screen could be
 * looked at, the shell's own `pwd` failed, and an install route refusing with
 * 507 because `statfs` reported under 100 MB free read for a while like a
 * regression in code that was correct.
 *
 * So the repository has its own scratch directory on the real disk, and the
 * scripts that spawn long-lived processes go through the wrapper that sets
 * it. `TMPDIR` is what Node's `os.tmpdir()`, vitest, Next and Playwright all
 * read, so one place covers all of them.
 *
 * This is not only a workaround for a full box: two runs in parallel stop
 * sharing a scratch space, and `npm run clean` can take the whole thing back.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = process.cwd();
const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;

/** The scripts that run long enough, or spawn enough, to need somewhere to write. */
const NEEDS_SCRATCH = ["dev", "build", "test", "test:watch", "test:coverage"];

describe("a command that writes while it runs", () => {
    it("goes through the wrapper that gives it somewhere to write", () => {
        const bare = NEEDS_SCRATCH.filter((name) => !scripts[name]?.includes("with-scratch.sh"));
        expect(
            bare,
            `these write scratch files to whatever TMPDIR happens to be, which on a\n` +
            `shared box is somebody else's to fill:\n${bare.join("\n")}`,
        ).toEqual([]);
    });

    it("has a wrapper that runs, and hands the command its own arguments", () => {
        const wrapper = path.join(ROOT, "scripts/with-scratch.sh");
        expect(fs.existsSync(wrapper)).toBe(true);
        const source = fs.readFileSync(wrapper, "utf8");
        // `exec "$@"` would look for a program called `NEXT_DEV=1`; `env` is
        // what lets a caller keep passing `VAR=value cmd`.
        expect(source).toContain("exec env");
        for (const variable of ["TMPDIR", "TMP", "TEMP"]) {
            expect(source, variable).toContain(`export ${variable}=`);
        }
    });

    it("sweeps the scratch directory when the tree is cleaned", () => {
        expect(scripts.clean).toContain(".tmp");
    });

    it("keeps the scratch directory out of the repository", () => {
        expect(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8")).toContain("/.tmp/");
    });

    it("keeps it out of the lint pass, where a copied file is still a file", () => {
        // A run may leave a copy of a source file here - a backup of something
        // being edited, a fixture, a whole module - and the linter has no way
        // to tell a copy from the original. It reported warnings against paths
        // nobody is going to edit, and `--max-warnings=0` is how CI runs.
        expect(fs.readFileSync(path.join(ROOT, "eslint.config.mjs"), "utf8")).toContain('".tmp/**"');
    });

    it("is what this very run is using", () => {
        // The suite runs through the wrapper, so its own temp directory is the
        // repository's. A run that is not is a run the wrapper did not reach.
        expect(os.tmpdir()).toBe(path.join(ROOT, ".tmp"));
    });
});
