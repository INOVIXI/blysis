// @vitest-environment node
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withClientOutput } from "../../scripts/lib/merge-prisma-schemas";
import { toolCommand } from "@/core/lib/tool-command";

/**
 * The client a module type check generates is named in a path Prisma can read.
 *
 * `typecheck-modules` points the merged schema's generator at its own output
 * directory, so the throwaway client never lands on the real one in
 * node_modules. It wrote that directory into the schema as the platform
 * spelled it. On Windows that is `C:\Users\...\client`, and a Prisma string
 * treats each backslash as the start of an escape: the schema failed to
 * parse ("Unknown escape sequence") and the gate failed before it checked a
 * single module. Prisma reads a forward slash as a separator on every
 * platform, so that is what goes in.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const WINDOWS_DIR = "C:\\Users\\someone\\blysis\\.typecheck-modules\\client";

const MERGED = [
    "generator client {",
    '  provider = "prisma-client-js"',
    "}",
    "",
    "datasource db {",
    '  provider = "postgresql"',
    "}",
    "",
    "model Probe {",
    "  id Int @id",
    "}",
    "",
].join("\n");

describe("a merged schema pointed at its own client", () => {
    it("names the directory with forward slashes", () => {
        const schema = withClientOutput(MERGED, WINDOWS_DIR);

        expect(schema).toContain('output   = "C:/Users/someone/blysis/.typecheck-modules/client"');
        expect(schema).not.toContain("\\");
    });

    it("replaces the generator it was given rather than adding a second one", () => {
        const schema = withClientOutput(MERGED, WINDOWS_DIR);

        expect(schema.match(/generator\s+client/g)).toHaveLength(1);
        expect(schema).toContain("model Probe");
    });

    it("is a schema Prisma accepts", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-output-"));
        try {
            fs.writeFileSync(path.join(dir, "schema.prisma"), withClientOutput(MERGED, WINDOWS_DIR));
            // Run from the scratch directory so the project's prisma.config.ts,
            // which wants a database, is not picked up. Without
            // CHECKPOINT_DISABLE the CLI leaves a detached update check running
            // in that directory, and Windows will not remove a directory a
            // live process is standing in.
            const result = spawnSync(...toolCommand(["npx", "prisma", "validate", "--schema", "schema.prisma"], ROOT), {
                cwd: dir,
                encoding: "utf8",
                timeout: 15000,
                env: { ...process.env, CHECKPOINT_DISABLE: "1" },
            });

            expect(`${result.stdout}${result.stderr}`).toContain("is valid");
            expect(result.status).toBe(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
