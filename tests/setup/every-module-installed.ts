/**
 * Vitest's global setup: on a checkout with no module installed, the run
 * installs every first-party module first and removes them afterwards, the
 * way CI's check job does. See scripts/lib/modules-for-a-run.ts for why, and
 * for why a checkout with modules installed is left as it is.
 */
import path from "node:path";
import { installEveryModuleForTheRun, regenerate } from "../../scripts/lib/modules-for-a-run";

const ROOT = path.resolve(import.meta.dirname, "../..");

export default function setup(): (() => void) | undefined {
    const restore = installEveryModuleForTheRun(ROOT);
    if (!restore) return undefined;
    process.stdout.write("[tests] no module is installed; running with every module from module-sources, removed afterwards\n");
    regenerate(ROOT);
    return restore;
}
