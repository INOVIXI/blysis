// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CORE_API_VERSION } from "@/core/lib/core-version";
import { satisfiesRange } from "@/core/lib/semver-range";
import { toolCommand } from "@/core/lib/tool-command";

/**
 * A module scaffolded by `npm run create:module` is one this core installs.
 *
 * The template's manifest said `"coreVersion": "^1.0.0"` and the scaffolder
 * copied it through, while the core it scaffolded for was 5.18.0. Install,
 * update and enable all refuse a module whose range the running core does not
 * satisfy, so the first thing a new author's module did was get refused, and
 * every first-party module in the tree had long since moved to `^5.0.0`.
 * The range is written from `CORE_API_VERSION` at scaffold time, so it cannot
 * fall behind again when the contract takes its next major.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
let workDir = "";
let manifest: { id: string; coreVersion: string };

beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-"));
    fs.cpSync(path.join(ROOT, "module-template"), path.join(workDir, "module-template"), { recursive: true });
    const result = spawnSync(...toolCommand(["npx", "tsx", path.join(ROOT, "scripts/create-module.ts"), "probe-module"], ROOT), {
        cwd: workDir,
        encoding: "utf8",
        timeout: 30000,
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    manifest = JSON.parse(fs.readFileSync(path.join(workDir, "module-sources/probe-module/module.json"), "utf8"));
});

afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

describe("a scaffolded module", () => {
    it("is the module that was asked for", () => {
        expect(manifest.id).toBe("probe-module");
    });

    it("declares a core range the running core satisfies", () => {
        expect(satisfiesRange(CORE_API_VERSION, manifest.coreVersion), manifest.coreVersion).toBe(true);
    });

    it("declares the current major, so the next breaking contract refuses it", () => {
        expect(manifest.coreVersion).toBe(`^${CORE_API_VERSION.split(".")[0]}.0.0`);
    });
});
