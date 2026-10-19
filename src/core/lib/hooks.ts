/**
 * Action/Filter hook API - the foundational extension mechanism.
 *
 * Actions: fire-and-forget notifications. `doAction("user.registered", payload)`
 * runs every listener in priority order; if one throws the rest still run.
 *
 * Filters: value-transformation chains. Each listener receives the running
 * value and returns the new one. Errors keep the previous value (fail-safe).
 *
 * Sync by default for hot paths; `doActionAsync` / `applyFiltersAsync` are
 * available for I/O-bound listeners and enforce a per-listener timeout so a
 * stalled module hook never blocks a user-facing request indefinitely.
 *
 * Modules register listeners declaratively via `module.json` hookListeners
 * (wired into the codegen registry as static imports) or imperatively via
 * addAction/addFilter. Listeners are removed on module disable/uninstall.
 *
 * This file is re-exported through the isomorphic SDK entry (`@/core/sdk`),
 * so it stays free of imports and logs through `console` rather than
 * `./logger`. A production bundler follows a barrel only along the names a
 * client component asked for, but `next dev` does not shake per name: it
 * compiles the whole barrel and everything it re-exports for the browser.
 * Anything needing the database, the logger or `next/headers` belongs in
 * `hooks-bootstrap.ts`.
 */

export type ActionListener<T = unknown> = (payload: T) => void;
export type AsyncActionListener<T = unknown> = (payload: T) => void | Promise<void>;
export type FilterListener<T = unknown, C = unknown> = (value: T, context?: C) => T;
export type AsyncFilterListener<T = unknown, C = unknown> = (value: T, context?: C) => T | Promise<T>;

/**
 * Payload declared for an action name, or `unknown` when nothing has claimed
 * that name. See src/core/types/hook-payloads.d.ts for how a module claims one.
 *
 * `unknown` is the deliberate fallback rather than `never` or `any`: an
 * undeclared hook must stay usable (a module may emit hooks core has never
 * heard of) without silently accepting a mistyped payload on a declared one.
 */
export type ActionPayload<K extends string> =
    K extends keyof BlysisHookPayloads ? BlysisHookPayloads[K] : unknown;

/** The value flowing through a filter chain, or `unknown` when undeclared. */
export type FilterValue<K extends string> =
    K extends keyof BlysisFilterPayloads ? BlysisFilterPayloads[K] : unknown;

/**
 * What a filter is asked about, or `unknown` when the hook does not say.
 *
 * A filter has two halves: the value that flows through the chain, and the
 * thing being asked about. Only the first used to be typed, so a listener read
 * its context through a cast and nothing checked the cast. Hooks that declare
 * a context in `BlysisFilterContexts` get both halves checked, at the call
 * site and in every listener; the rest behave exactly as before.
 */
export type FilterContext<K extends string> =
    K extends keyof BlysisFilterContexts ? BlysisFilterContexts[K] : unknown;

/**
 * The trailing argument of `applyFilters`/`applyFiltersAsync`.
 *
 * A hook that declares a context must be passed one - the whole point of
 * declaring it is that listeners can then read it without a guard. A hook that
 * declares none keeps the old optional `unknown`.
 */
export type FilterContextArg<K extends string> =
    K extends keyof BlysisFilterContexts ? [context: BlysisFilterContexts[K]] : [context?: unknown];

/** The listener shape for a filter, with its context typed and required. */
export type FilterHandler<K extends string> =
    K extends keyof BlysisFilterContexts
        ? (value: FilterValue<K>, context: BlysisFilterContexts[K]) => FilterValue<K> | Promise<FilterValue<K>>
        : AsyncFilterListener<FilterValue<K>>;

interface Registration {
    listener: (...args: unknown[]) => unknown;
    priority: number;
    moduleId?: string;
}

const actionRegistry = new Map<string, Registration[]>();
const filterRegistry = new Map<string, Registration[]>();

/** Lower priority runs earlier. 10 is the conventional default. */
const DEFAULT_PRIORITY = 10;

/**
 * Per-listener timeout for async dispatch. A stalled module listener must
 * never freeze a user-facing flow (login, registration, checkout all await
 * hook chains). Listeners exceeding the limit are abandoned and logged,
 * except a filter listener working on the caller's transaction: see
 * `onTheCallersTransaction`.
 * Override via HOOK_LISTENER_TIMEOUT_MS env (resolved lazily for tests).
 */
const DEFAULT_HOOK_TIMEOUT_MS = 5000;

function getHookListenerTimeoutMs(): number {
    const raw = Number(process.env.HOOK_LISTENER_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HOOK_TIMEOUT_MS;
}

function raceWithTimeout<T>(promise: Promise<T> | T, label: string): Promise<T> {
    const timeoutMs = getHookListenerTimeoutMs();
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error(`hook listener timeout after ${timeoutMs}ms: ${label}`));
        }, timeoutMs);
        Promise.resolve(promise).then(
            (value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(err);
            },
        );
    });
}

/**
 * True when a filter's context carries the caller's open transaction.
 *
 * A listener handed it writes on that transaction, and the caller commits
 * once the filter returns. Abandoned at the timeout, its writes would still
 * land in that commit while the caller read the default value and went on as
 * if nothing had happened: measured on credit transfers, the sender lost the
 * credits and the recipient got none. Such a listener is waited for. A
 * transaction that is too slow ends at the database's own timeout and rolls
 * back whole, which is the outcome a timeout is meant to give.
 */
function onTheCallersTransaction(context: unknown): boolean {
    return typeof context === "object" && context !== null && "tx" in context && Boolean((context as { tx: unknown }).tx);
}

function addRegistration(map: Map<string, Registration[]>, name: string, reg: Registration) {
    const list = map.get(name) || [];
    list.push(reg);
    list.sort((a, b) => a.priority - b.priority);
    map.set(name, list);
}

function removeRegistration(map: Map<string, Registration[]>, name: string, listener: (...args: unknown[]) => unknown) {
    const list = map.get(name);
    if (!list) return;
    const filtered = list.filter((r) => r.listener !== listener);
    if (filtered.length === 0) {
        map.delete(name);
    } else {
        map.set(name, filtered);
    }
}

/* ───────────────────────────── Actions ──────────────────────────────── */

/**
 * `T` defaults to the registry entry for `name` and is normally left alone -
 * an unannotated listener parameter is typed from the registry. Annotating it
 * explicitly still works (needed when `name` is a variable rather than a
 * literal), but on a declared hook the annotation must be compatible with the
 * declared payload.
 */
export function addAction<K extends string, T extends ActionPayload<K> = ActionPayload<K>>(
    name: K,
    listener: ActionListener<T> | AsyncActionListener<T>,
    options: { priority?: number; moduleId?: string } = {}
): void {
    addRegistration(actionRegistry, name, {
        listener: listener as (...args: unknown[]) => unknown,
        priority: options.priority ?? DEFAULT_PRIORITY,
        moduleId: options.moduleId,
    });
}

export function removeAction<T>(name: string, listener: ActionListener<T> | AsyncActionListener<T>): void {
    removeRegistration(actionRegistry, name, listener as (...args: unknown[]) => unknown);
}

/** Synchronous action dispatch. Errors in listeners are logged but do not propagate. */
export function doAction<K extends string>(name: K, payload: ActionPayload<K>): void {
    const list = actionRegistry.get(name);
    if (!list || list.length === 0) return;
    for (const reg of list) {
        try {
            (reg.listener as ActionListener<ActionPayload<K>>)(payload);
        } catch (err) {
            console.error(`[hooks] Action "${name}" listener failed:`, err);
        }
    }
}

/** Async action dispatch. Awaits each listener in priority order. Errors are isolated. */
export async function doActionAsync<K extends string>(name: K, payload: ActionPayload<K>): Promise<void> {
    const list = actionRegistry.get(name);
    if (!list || list.length === 0) return;
    for (const reg of list) {
        try {
            await raceWithTimeout(
                (reg.listener as AsyncActionListener<ActionPayload<K>>)(payload),
                `${name} (${reg.moduleId ?? "core"})`,
            );
        } catch (err) {
            console.error(`[hooks] Async action "${name}" listener failed:`, err);
        }
    }
}

/* ───────────────────────────── Filters ──────────────────────────────── */

export function addFilter<K extends string, T extends FilterValue<K> = FilterValue<K>, C = unknown>(
    name: K,
    listener: FilterListener<T, C> | AsyncFilterListener<T, C>,
    options: { priority?: number; moduleId?: string } = {}
): void {
    addRegistration(filterRegistry, name, {
        listener: listener as (...args: unknown[]) => unknown,
        priority: options.priority ?? DEFAULT_PRIORITY,
        moduleId: options.moduleId,
    });
}

export function removeFilter<T, C = unknown>(name: string, listener: FilterListener<T, C> | AsyncFilterListener<T, C>): void {
    removeRegistration(filterRegistry, name, listener as (...args: unknown[]) => unknown);
}

/**
 * Apply a filter chain synchronously. Returns the transformed value.
 *
 * On a declared filter name the value is pinned to the declared type; on an
 * undeclared one it is inferred from the argument, so ad-hoc filter chains keep
 * working with no registry entry.
 */
export function applyFilters<K extends string, V extends FilterValue<K>>(
    name: K,
    value: V,
    ...rest: FilterContextArg<K>
): K extends keyof BlysisFilterPayloads ? BlysisFilterPayloads[K] : V {
    const context = rest[0];
    const list = filterRegistry.get(name);
    if (!list || list.length === 0) return value as never;
    let result = value;
    for (const reg of list) {
        try {
            result = (reg.listener as FilterListener<V, unknown>)(result, context);
        } catch (err) {
            console.error(`[hooks] Filter "${name}" listener failed:`, err);
            // Keep the previous value on error (fail-safe).
        }
    }
    return result as never;
}

/** Async filter chain - each listener can return a Promise. */
export async function applyFiltersAsync<K extends string, V extends FilterValue<K>>(
    name: K,
    value: V,
    ...rest: FilterContextArg<K>
): Promise<K extends keyof BlysisFilterPayloads ? BlysisFilterPayloads[K] : V> {
    const context = rest[0];
    const list = filterRegistry.get(name);
    if (!list || list.length === 0) return value as never;
    const waited = onTheCallersTransaction(context);
    let result = value;
    for (const reg of list) {
        try {
            const answer = (reg.listener as AsyncFilterListener<V, unknown>)(result, context);
            result = waited ? await answer : await raceWithTimeout(answer, `${name} (${reg.moduleId ?? "core"})`);
        } catch (err) {
            console.error(`[hooks] Async filter "${name}" listener failed:`, err);
            // Keep the previous value so a slow/broken listener doesn't
            // corrupt the chain - downstream listeners still get a value.
        }
    }
    return result as never;
}

/* ─────────────────── Manifest listener type contract ────────────────── */

/**
 * The handler shape a `hookListeners` entry must export as its default.
 *
 * Listener payloads are contravariant: a handler is free to declare fewer
 * fields than the hook carries (it just reads less), but not more, and not
 * different ones.
 */
export type HookHandlerFor<K extends string, T extends "action" | "filter"> =
    T extends "action"
        ? AsyncActionListener<ActionPayload<K>>
        : FilterHandler<K>;

type DeclaredNames<T extends "action" | "filter"> =
    T extends "action" ? keyof BlysisHookPayloads : keyof BlysisFilterPayloads;

/**
 * Resolves to `true` when a manifest-declared handler matches the payload its
 * hook is declared to carry, and to a descriptive object otherwise - which
 * `Expect` below turns into a compile error naming the hook.
 *
 * Manifest listeners are wired by codegen through a dynamic import, so their
 * signature is erased and nothing would otherwise check it: a handler reading
 * `payload.orderNumber` from a hook that carries `{ id }` fails at runtime, on
 * a code path that only runs when two particular modules are both installed.
 * This moves that failure to `npm run typecheck:modules`.
 *
 * A hook no module has declared a payload for resolves to `true` - undeclared
 * hooks stay usable, they simply are not checked.
 */
export type AssertHookHandler<K extends string, T extends "action" | "filter", F> =
    K extends DeclaredNames<T>
        ? F extends HookHandlerFor<K, T>
            ? true
            : { error: "handler does not accept the payload this hook carries"; hook: K; expected: HookHandlerFor<K, T>; got: F }
        : true;

/** Forces an `AssertHookHandler` result to be checked. */
export type Expect<T extends true> = T;

/* ───────────────────────── Module lifecycle ─────────────────────────── */

/** Remove all hooks registered by a module (called on disable/uninstall). */
export function removeModuleHooks(moduleId: string): void {
    for (const [name, list] of actionRegistry.entries()) {
        const filtered = list.filter((r) => r.moduleId !== moduleId);
        if (filtered.length === 0) actionRegistry.delete(name);
        else actionRegistry.set(name, filtered);
    }
    for (const [name, list] of filterRegistry.entries()) {
        const filtered = list.filter((r) => r.moduleId !== moduleId);
        if (filtered.length === 0) filterRegistry.delete(name);
        else filterRegistry.set(name, filtered);
    }
}

/* ───────────────────────── Introspection ────────────────────────────── */

/** List all registered action hooks (for dev tools / debugging). */
export function listActions(): { name: string; count: number; modules: string[] }[] {
    return Array.from(actionRegistry.entries()).map(([name, list]) => ({
        name,
        count: list.length,
        modules: Array.from(new Set(list.map((r) => r.moduleId || "core"))),
    }));
}

/** List all registered filter hooks. */
export function listFilters(): { name: string; count: number; modules: string[] }[] {
    return Array.from(filterRegistry.entries()).map(([name, list]) => ({
        name,
        count: list.length,
        modules: Array.from(new Set(list.map((r) => r.moduleId || "core"))),
    }));
}

/** Count listeners for a specific hook. Useful for conditional logic. */
export function hasAction(name: string): boolean {
    const list = actionRegistry.get(name);
    return !!list && list.length > 0;
}

export function hasFilter(name: string): boolean {
    const list = filterRegistry.get(name);
    return !!list && list.length > 0;
}

/* ───────────────────────── Bootstrap ───────────────────────────────── */

let bootstrapped = false;

/**
 * The bootstrap itself lives in `hooks-bootstrap.ts`, out of reach of a
 * browser bundle; the flag stays here because `resetHooks` clears it in the
 * same breath as the registries.
 */
export function isBootstrapped(): boolean {
    return bootstrapped;
}

export function markBootstrapped(): void {
    bootstrapped = true;
}

/** Force re-bootstrap (used when modules are enabled/disabled at runtime). */
export function resetHooks(): void {
    actionRegistry.clear();
    filterRegistry.clear();
    bootstrapped = false;
}

// ===== Standard hook names =====
// Convention only - modules may use any string. Format: `<noun>.<verb>` for
// actions, `<noun>.<adjective>` for filters; resource events like
// "store.product.created" / "blog.article.updated" are emitted by modules.
export const HookNames = {
    MODULE_ENABLED: "module.enabled",
    MODULE_DISABLED: "module.disabled",
    MODULE_INSTALLED: "module.installed",
    MODULE_UNINSTALLED: "module.uninstalled",

    USER_REGISTERED: "user.registered",
    USER_LOGGED_IN: "user.loggedIn",
    USER_LOGGED_OUT: "user.loggedOut",
    USER_UPDATED: "user.updated",
    USER_DELETED: "user.deleted",
    USER_BANNED: "user.banned",

    EMAIL_SUBJECT: "email.subject",
    EMAIL_BODY: "email.body",
} as const;
