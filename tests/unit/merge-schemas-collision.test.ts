// @vitest-environment node
/**
 * scripts/merge-schemas.ts must warn when a module schema redeclares a core
 * model name (e.g. `User`, `Role`). Without this warning, a module author
 * who tries to extend `User` by redeclaring it gets the field SILENTLY
 * dropped - the merger keeps only the core copy.
 *
 * The script is a runnable side-effect script (no exported function), so we
 * invoke it as a child process pointing at a throw-away temp project root
 * that contains:
 *   - prisma/schema.core.prisma (minimal core schema with `User`)
 *   - src/modules/<id>/schema.prisma (redeclares `model User`)
 *
 * The warning fires BEFORE `prisma generate` is invoked, so even if the
 * post-merge `npx prisma generate` step fails in the temp project (no real
 * DB, no node_modules), the warning is still emitted on stderr and captured
 * by execFileSync's stderr buffer in the catch block.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { toolCommand } from "@/core/lib/tool-command";

const PROJECT_ROOT = path.resolve(__dirname, "../../");
const SCRIPT_PATH = path.join(PROJECT_ROOT, "scripts/merge-schemas.ts");

let tmpRoot: string;

beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "blysis-merge-test-"));

    // Core schema with a User model.
    fs.mkdirSync(path.join(tmpRoot, "prisma"), { recursive: true });
    fs.writeFileSync(
        path.join(tmpRoot, "prisma/schema.core.prisma"),
        [
            'generator client { provider = "prisma-client-js" }',
            'datasource db { provider = "postgresql"; url = env("DATABASE_URL") }',
            "",
            "model User {",
            "  id String @id",
            "  email String @unique",
            "  // @@MODULE_RELATIONS",
            "}",
            "",
        ].join("\n"),
    );

    // A module that redeclares the core `User` model.
    const modDir = path.join(tmpRoot, "src/modules/colliding-mod");
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(
        path.join(modDir, "schema.prisma"),
        [
            "model User {",
            "  id String @id",
            "  evilField String?",
            "}",
            "",
        ].join("\n"),
    );
});

afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("merge-schemas core-model collision warning", () => {
    // Why 60s (not 30s): this spawns `tsx scripts/merge-schemas.ts` COLD -
    // tsx boots an esbuild-backed TS loader, then the script
    // runs `npx prisma generate` (which fails fast here, but still pays its own
    // cold-start). In isolation that's ~5s, but under the full `npm test` run
    // the box is saturated by ~40 other workers, and a 30s Vitest per-test
    // timeout RACED the 30s child `timeout` - whichever fired first produced an
    // intermittent failure. The fixes, applied together:
    //   1. Vitest per-test timeout raised to 60s for real headroom.
    //   2. The child `execFileSync` timeout LOWERED to 45s so the child is
    //      always killed (and its buffered stderr surfaced for the assertion)
    //      strictly BEFORE Vitest's own timeout can abort the test - the two
    //      timeouts no longer race at the same value.
    //   3. `TSX_TSCONFIG_PATH`/`--no-cache` avoided; instead we let tsx use its
    //      on-disk transform cache (warm after the first spawn in the suite),
    //      shaving cold-start on repeat runs.
    it("emits a WARNING when a module redeclares a core model", { timeout: 60_000 }, () => {
        let stdout = "";
        let stderr = "";
        try {
            // Started through `toolCommand`, not as `npx`: on Windows `npx` is
            // a `.cmd` shim a shell-less spawn cannot find. tsx is resolved
            // from this project, because the temp root has no node_modules.
            const out = execFileSync(
                ...toolCommand(["npx", "tsx", SCRIPT_PATH], PROJECT_ROOT),
                {
                    cwd: tmpRoot,
                    env: { ...process.env },
                    encoding: "utf-8",
                    stdio: "pipe",
                    timeout: 45_000,
                },
            );
            stdout = out;
        } catch (err) {
            const e = err as { stdout?: string; stderr?: string; message?: string };
            stdout = e.stdout ?? "";
            stderr = e.stderr ?? "";
            // Surface failure details if this turns into a debug session
            if (!stdout && !stderr) stderr = e.message ?? "";
        }

        const combined = stdout + stderr;
        expect(combined, JSON.stringify({ stdout, stderr })).toMatch(
            /WARNING.*colliding-mod.*redeclares.*core model.*User/i,
        );
    });
});
