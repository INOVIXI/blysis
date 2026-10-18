/**
 * Waking a held long-poll the moment there is something for it.
 *
 * Blysis runs one app process per installation, so an in-memory signal
 * reaches every waiting poll. It is only a shortcut: a poll also looks again
 * on its own every few seconds, so a signal that is missed, or written by a
 * process this one cannot hear, costs seconds and never a delivery.
 *
 * The registry hangs off `globalThis` because Next can load this file more
 * than once (a route and a hook listener are separate bundles), and two
 * registries would mean a wake that nobody hears.
 */

type Waiter = () => void;

interface WakeRegistry {
    byServer: Map<string, Set<Waiter>>;
}

const KEY = Symbol.for("blysis.game-connect.wake");

function registry(): WakeRegistry {
    const holder = globalThis as unknown as Record<symbol, WakeRegistry | undefined>;
    let found = holder[KEY];
    if (!found) {
        found = { byServer: new Map() };
        holder[KEY] = found;
    }
    return found;
}

/** Wakes the polls held for one server, or for every server when given null. */
export function wake(gameServerId: string | null): void {
    const { byServer } = registry();
    const targets = gameServerId === null ? [...byServer.values()] : [byServer.get(gameServerId)];
    for (const waiters of targets) {
        if (!waiters) continue;
        for (const waiter of [...waiters]) waiter();
    }
}

/**
 * Resolves when the server is woken, when `ms` runs out, or when the request
 * is abandoned. Always resolves; the caller decides what to do next.
 */
export function waitForWake(gameServerId: string, ms: number, signal?: AbortSignal): Promise<"woken" | "timeout" | "aborted"> {
    const { byServer } = registry();
    return new Promise((resolve) => {
        let waiters = byServer.get(gameServerId);
        if (!waiters) {
            waiters = new Set();
            byServer.set(gameServerId, waiters);
        }
        const done = (outcome: "woken" | "timeout" | "aborted") => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            waiters!.delete(waiter);
            if (waiters!.size === 0) byServer.delete(gameServerId);
            resolve(outcome);
        };
        const waiter: Waiter = () => done("woken");
        const onAbort = () => done("aborted");
        const timer = setTimeout(() => done("timeout"), Math.max(0, ms));
        waiters.add(waiter);
        if (signal?.aborted) done("aborted");
        else signal?.addEventListener("abort", onAbort, { once: true });
    });
}
