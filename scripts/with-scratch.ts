/**
 * Run a command with this repository's own scratch directory.
 *
 * Measured on the development box on 2026-09-20: /tmp is a 32 GB tmpfs shared
 * with nine other projects on the same machine, and it reached zero bytes free
 * while the suite was running. The failures that produces do not look like what
 * they are - `cp: error writing ... No space left on device` from inside a test
 * that stands up a temp module, a Chromium that dies before the login form,
 * `pwd: write error` from the shell itself - and one of them, an install route
 * refusing with 507 because statfs reported under 100 MB free, read for a while
 * like a regression in code that was correct.
 *
 * So the repository gets its own, on the real disk, gitignored. It is not only
 * a workaround for a full box: two runs in parallel no longer share a scratch
 * space, and `npm run clean` can take the whole thing back.
 *
 * TMPDIR is what Node's os.tmpdir(), vitest, Next and Playwright all read.
 *
 * A Node script, because it has to start wherever npm does. It was POSIX sh,
 * since the production image is node:24-alpine and has no bash, but Windows
 * runs npm scripts with cmd.exe, which has no sh either, so not one test, dev
 * server or build started there. The command is started through
 * `toolCommand`, without a shell, on every platform.
 *
 *   tsx scripts/with-scratch.ts [NAME=value ...] <tool> [args ...]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { toolCommand } from "../src/core/lib/tool-command";

const SCRATCH = path.join(process.cwd(), ".tmp");
fs.mkdirSync(SCRATCH, { recursive: true });

// Some tools read the other two; keeping all three in step means nothing falls
// back to the system temp directory halfway through a run.
const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: SCRATCH, TMP: SCRATCH, TEMP: SCRATCH };

// The scripts pass settings as `NAME=value cmd`, which only a POSIX shell
// understands as an environment variable; here it is read the same way.
const args = process.argv.slice(2);
while (args.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) {
    const assignment = args.shift() as string;
    const at = assignment.indexOf("=");
    env[assignment.slice(0, at)] = assignment.slice(at + 1);
}

if (args.length === 0) {
    console.error("Usage: tsx scripts/with-scratch.ts [NAME=value ...] <tool> [args ...]");
    process.exit(2);
}

const child = spawn(...toolCommand(["npx", ...args]), { stdio: "inherit", env });

// A dev server stopped with Ctrl+C, or a build an install times out, has to
// stop the tool and not only this wrapper around it.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 128 + os.constants.signals[signal] : 1);
});
