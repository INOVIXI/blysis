import fs from "fs";
import path from "path";
import { PROJECT_ROOT } from "./runtime-paths";

/**
 * The `[file, args]` pair that starts one of the project's command-line
 * tools, ready to spread into any `child_process` call.
 *
 * Code here used to spawn `npx` and `npm` by name, without a shell. That works
 * wherever those are executables on PATH, which is everywhere but Windows:
 * there both are `.cmd` shims, which a shell-less spawn cannot find (ENOENT)
 * and which Node refuses to start without a shell when named outright
 * (EINVAL, since the CVE-2024-27980 fix). Handing the work to a shell would
 * bring back the quoting problem that fix exists for. So the tool's own entry
 * script is started with the Node that is already running, which behaves the
 * same on every platform and passes every argument through untouched.
 *
 * The argv is written the way a person would type it, `["npx", "tsx",
 * "scripts/merge-schemas.ts"]` or `["npm", "run", "build"]`, so a call site
 * still reads as the command it runs. An `npx` tool is resolved from the
 * project's own `node_modules` and never fetched: a missing tool is a broken
 * install, and says so rather than downloading something at runtime. The
 * default root is `PROJECT_ROOT` rather than a `process.cwd()` of its own,
 * for the tracing reason `runtime-paths.ts` gives: install routes import this.
 * `tests/unit/a-tool-starts-on-every-platform.test.ts` fails on any spawn of
 * `npx` or `npm` that does not come through here.
 */
export function toolCommand(argv: readonly string[], root: string = PROJECT_ROOT): [string, string[]] {
    const [launcher, ...rest] = argv;
    if (launcher === "npx") {
        const [command, ...args] = rest;
        if (!command) throw new Error("npx needs the name of a tool to run");
        return [process.execPath, [binScript(command, root), ...args]];
    }
    if (launcher === "npm") return npmCommand(rest);
    throw new Error(`${launcher} is not a project tool, so toolCommand cannot start it`);
}

/** Commands whose package is published under another name. */
const PACKAGE_OF_COMMAND: Record<string, string> = { tsc: "typescript" };

function binScript(command: string, root: string): string {
    const pkg = PACKAGE_OF_COMMAND[command] ?? command;
    const dir = path.join(root, "node_modules", pkg);
    let manifest: { bin?: string | Record<string, string> };
    try {
        manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {
        throw new Error(`${command} is not installed in ${root}; run npm install`);
    }
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[command];
    if (!bin) throw new Error(`the ${pkg} package has no ${command} command`);
    return path.join(dir, bin);
}

/**
 * npm names its own entry script in `npm_execpath` for everything it starts,
 * which covers a server run through `npm start` and a script run through
 * npx. Anything else finds it beside the Node binary: in `node_modules` on
 * Windows, in `../lib/node_modules` on Linux and macOS. Where neither holds,
 * a POSIX system still has an `npm` executable on PATH, so it is spawned by
 * name exactly as before; Windows has nothing left to try.
 */
function npmCommand(args: string[]): [string, string[]] {
    const nodeDir = path.dirname(process.execPath);
    const script = [
        process.env.npm_execpath,
        path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
        path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ].find((candidate) => candidate?.endsWith("npm-cli.js") && fs.existsSync(candidate));

    if (script) return [process.execPath, [script, ...args]];
    if (process.platform !== "win32") return ["npm", args];
    throw new Error(`npm's entry script is not beside ${process.execPath}; is npm installed?`);
}
