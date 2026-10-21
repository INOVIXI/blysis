// @vitest-environment node
/**
 * A checkout with no module installed is tested the way CI tests it.
 *
 * Thirty tests read registries generated from `src/modules`, and a fresh
 * clone has none, so `npm test` there failed thirty times while CI, which
 * copies `module-sources` in first, was green. A run that finds nothing
 * installed now installs every module for its own length and removes them
 * after. A run that finds a developer's modules leaves them exactly as they
 * are, because that directory is their install state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installEveryModuleForTheRun, installedModuleIds } from "../../scripts/lib/modules-for-a-run";

const OWNED = "BLYSIS_MODULES_INSTALLED_FOR_A_RUN";
let root: string;
let saved: string | undefined;
const regenerate = vi.fn();

function write(rel: string, text: string) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

beforeEach(() => {
    saved = process.env[OWNED];
    delete process.env[OWNED];
    root = fs.mkdtempSync(path.join(os.tmpdir(), "modules-for-a-run-"));
    write("module-sources/shop/module.json", "{}");
    write("module-sources/forum/module.json", "{}");
    regenerate.mockClear();
});

afterEach(() => {
    if (saved === undefined) delete process.env[OWNED];
    else process.env[OWNED] = saved;
    fs.rmSync(root, { recursive: true, force: true });
});

describe("a run on a checkout with nothing installed", () => {
    it("installs every module from module-sources", () => {
        expect(installEveryModuleForTheRun(root, regenerate)).not.toBeNull();
        expect(installedModuleIds(root).sort()).toEqual(["forum", "shop"]);
    });

    it("puts the tree back when it ends", () => {
        installEveryModuleForTheRun(root, regenerate)!();
        expect(fs.existsSync(path.join(root, "src/modules"))).toBe(false);
        expect(regenerate).toHaveBeenCalledWith(root);
    });

    it("is not undone by a run it starts", () => {
        // verify runs the suite as one of its gates, and the build after it
        // still needs the modules.
        installEveryModuleForTheRun(root, regenerate);
        expect(installEveryModuleForTheRun(root, regenerate)).toBeNull();
    });
});

describe("a run on a developer's install", () => {
    it("leaves it alone", () => {
        write("src/modules/shop/module.json", '{"mine":true}');
        expect(installEveryModuleForTheRun(root, regenerate)).toBeNull();
        expect(installedModuleIds(root)).toEqual(["shop"]);
        expect(fs.readFileSync(path.join(root, "src/modules/shop/module.json"), "utf8")).toBe('{"mine":true}');
    });
});

describe("a run after one that was stopped half way", () => {
    it("recognises the copy that was left and removes it this time", () => {
        installEveryModuleForTheRun(root, regenerate);
        delete process.env[OWNED];
        fs.writeFileSync(path.join(root, "src/modules/shop/left-behind.txt"), "");

        const restore = installEveryModuleForTheRun(root, regenerate);
        expect(restore).not.toBeNull();
        // Reused, not copied again over the top.
        expect(fs.existsSync(path.join(root, "src/modules/shop/left-behind.txt"))).toBe(true);
        restore!();
        expect(fs.existsSync(path.join(root, "src/modules"))).toBe(false);
    });
});
