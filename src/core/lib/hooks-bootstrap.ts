/**
 * Wiring that turns the hook bus into a running system: the core listeners,
 * the generated module listener registry, and the `core.boot` action that
 * modules hang DB-driven registration off.
 *
 * It sits apart from `hooks.ts` because that file is re-exported through the
 * isomorphic SDK entry and has to stay importable from a browser bundle.
 * Every import below reaches the database, the logger or a module's server
 * code. While the two halves shared a file, `npm run build` shook the edge
 * away and stayed green, and `next dev` compiled it and answered 500 on
 * every page whose client graph touched the barrel.
 */
import {
    addAction,
    addFilter,
    doActionAsync,
    isBootstrapped,
    markBootstrapped,
    setHookFailureReporter,
    type ActionListener,
    type FilterListener,
} from "./hooks";
import { errorText, log } from "./logger";

/**
 * Load and register all module hook listeners.
 * Called once per server process. Idempotent.
 *
 * Reads from the auto-generated module-hooks.ts registry and lazy-imports
 * each listener module. Modules whose status is "disabled" in module-cache
 * are skipped. Disabled modules' listeners are removed when status changes
 * (via removeModuleHooks).
 */
/**
 * Make sure this module graph's hook bus holds the module listeners.
 *
 * `instrumentation.ts` bootstraps once per process, but it runs in its own
 * module graph: the registry it fills is not the one a route handler reads.
 * Measured against a production build - a cold server logged 56 listeners
 * registered and then served an empty payment gateway list in three
 * milliseconds without a query, because `applyFiltersAsync` in the app's
 * graph found no listeners and returned its input. No error, no log line.
 *
 * So anything about to ask a module a question calls this first. After the
 * first call in a graph it is a boolean comparison, which is what makes it
 * safe on a per-request path.
 */
export async function ensureHooks(): Promise<void> {
    if (isBootstrapped()) return;
    await bootstrapHooks();
}

export async function bootstrapHooks(): Promise<void> {
    if (isBootstrapped()) return;
    markBootstrapped();
    setHookFailureReporter((message, err) => log.error(message, { error: errorText(err) }));

    // Core listeners - activity feed, etc. (module-specific listeners live in their modules)
    try {
        const { registerActivityFeedListeners } = await import("./activity-feed");
        registerActivityFeedListeners();
    } catch (err) {
        log.error("[hooks] Failed to register core listeners", { error: errorText(err) });
    }

    try {
        const { ModuleHookListeners } = await import("@/core/generated/module-hooks");
        const { getModuleStates } = await import("@/core/lib/module-cache");
        const states = await getModuleStates();

        for (const entry of ModuleHookListeners) {
            // Skip disabled modules
            if (states[entry.module] === false) continue; // skip disabled

            try {
                const mod = await entry.loader();
                const listener = mod.default;
                if (typeof listener !== "function") {
                    log.warn(`[hooks] ${entry.module}/${entry.hook}: handler did not export a default function`);
                    continue;
                }
                if (entry.type === "action") {
                    addAction(entry.hook, listener as ActionListener, {
                        priority: entry.priority,
                        moduleId: entry.module,
                    });
                } else {
                    addFilter(entry.hook, listener as FilterListener, {
                        priority: entry.priority,
                        moduleId: entry.module,
                    });
                }
            } catch (err) {
                log.error(`[hooks] Failed to load ${entry.module}/${entry.hook}`, { error: errorText(err) });
            }
        }

        log.info(`[hooks] Registered ${ModuleHookListeners.length} module hook listeners`);
    } catch (err) {
        // The generated registry may not exist on first build.
        log.warn("[hooks] Could not load module-hooks registry", { error: String((err as Error).message) });
    }

    // Once every module's static listeners are wired, fire core.boot so modules
    // that need DB-driven dynamic listener registration (e.g. an engine that
    // reads rules from its own tables) can hook in without core having to know
    // about them.
    try {
        await doActionAsync("core.boot", {});
    } catch (err) {
        log.warn("[hooks] core.boot listener failed", { error: String((err as Error).message) });
    }
}
