/**
 * Every first-party module, installed for the length of one run.
 *
 * A fresh checkout has no `src/modules`, and the registries generated from it
 * are then empty: no module routes, no module endpoints in the API reference,
 * no module permissions. Thirty tests read those registries, so `npm test` on
 * a clean clone failed thirty times while CI, which copies `module-sources`
 * into `src/modules` before anything runs, was green.
 *
 * So a run that finds nothing installed does what CI does, and puts the tree
 * back afterwards. A run that finds modules installed leaves them alone: that
 * directory is a developer's install state, and reseeding it would silently
 * discard a module they installed to test against. That is the reason
 * `verify` never reseeded, and it still holds.
 *
 * The marker under `.tmp` is how a run tells its own copy from somebody's
 * install. A run stopped half way leaves the copy and the marker behind, and
 * the next run recognises both and cleans up after it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { toolCommand } from "../../src/core/lib/tool-command";

/** What turns `src/modules` into the generated registries, in CI's order. */
const GENERATORS = [
    ["npx", "tsx", "scripts/merge-schemas.ts"],
    ["npx", "tsx", "scripts/generate-theme-registry.ts"],
    ["npx", "tsx", "scripts/generate-registry.ts"],
    ["npx", "tsx", "scripts/generate-openapi.ts"],
];

export function installedModuleIds(root: string): string[] {
    const dir = path.join(root, "src/modules");
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "module.json")))
        .map((entry) => entry.name);
}

const markerOf = (root: string) => path.join(root, ".tmp", "modules-installed-for-a-run");

/**
 * Set by the run that made the copy, and inherited by every process it
 * starts. `verify` runs the test suite as one of its gates; without this the
 * suite would take the copy for a stale one of its own and remove it before
 * the build gate that comes after.
 */
const OWNED = "BLYSIS_MODULES_INSTALLED_FOR_A_RUN";

export function regenerate(root: string): void {
    for (const argv of GENERATORS) {
        const result = spawnSync(...toolCommand(argv, root), { cwd: root, encoding: "utf8" });
        if (result.status !== 0) {
            throw new Error(`${argv.join(" ")} exited ${result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
        }
    }
}

/**
 * Install every module from `module-sources` when none is installed, and
 * return what puts the tree back; `null` when the run should use what is
 * there. The registries are not regenerated here, because a caller whose
 * next step is the generators would only run them twice.
 */
export function installEveryModuleForTheRun(
    root: string,
    regenerateTree: (root: string) => void = regenerate,
): (() => void) | null {
    if (process.env[OWNED]) return null;
    const marker = markerOf(root);
    const installed = installedModuleIds(root).length > 0;
    if (installed && !fs.existsSync(marker)) return null;

    if (!installed) {
        const target = path.join(root, "src/modules");
        fs.rmSync(target, { recursive: true, force: true });
        fs.cpSync(path.join(root, "module-sources"), target, { recursive: true });
        fs.mkdirSync(path.dirname(marker), { recursive: true });
        fs.writeFileSync(marker, "src/modules is a copy of module-sources for one run; it is removed when the run ends.\n");
    }

    process.env[OWNED] = "1";
    return () => {
        fs.rmSync(path.join(root, "src/modules"), { recursive: true, force: true });
        regenerateTree(root);
        fs.rmSync(marker, { force: true });
        delete process.env[OWNED];
    };
}
