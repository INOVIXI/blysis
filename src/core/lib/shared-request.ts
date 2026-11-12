/**
 * One request per URL per page, however many copies of the caller exist.
 *
 * Deduplicating with a module-level variable is the obvious way to write
 * this, and it holds exactly as long as the bundler keeps one copy of the
 * module. Code splitting does not promise that. Two chunks on the homepage
 * each carried their own copy of the settings hook, each with its own
 * "in flight" variable, so a hook written to fetch once fetched five times;
 * four store widgets in four chunks asked for the same totals fifteen times.
 *
 * The store therefore hangs off `globalThis` under a symbol: a second copy of
 * this file finds the same object rather than starting a private one.
 *
 * This is a read cache for GET traffic that several components happen to want
 * at the same moment. It is not a data layer: nothing revalidates, nothing
 * subscribes, and a mutation should call `invalidateShared` for the URLs it
 * affects.
 */

export const SHARED_STATE_KEY = Symbol.for("blysis.shared-request");

interface Entry {
    /** Resolved payload, present once a request has succeeded. */
    value?: unknown;
    /** The request itself while it is still in the air. */
    promise?: Promise<unknown>;
    /** Epoch ms after which `value` is stale. */
    expires: number;
}

type Store = Map<string, Entry>;

function store(): Store {
    const g = globalThis as unknown as Record<symbol, Store | undefined>;
    let s = g[SHARED_STATE_KEY];
    if (!s) {
        s = new Map();
        g[SHARED_STATE_KEY] = s;
    }
    return s;
}

/** Default freshness. Short, because this exists to collapse one page load. */
const DEFAULT_TTL_MS = 60_000;

/**
 * Drop entries that can no longer be served.
 *
 * The store is keyed by URL and a URL carries its query string, so `?page=1`
 * and `?page=2` are separate entries. Leaving an expired one in place costs
 * nothing to read and everything to keep: a long session accumulates a map it
 * never reads from again. An in-flight entry is never dropped, because a
 * caller is holding its promise.
 */
function sweep(s: Store, now: number): void {
    for (const [key, entry] of s) {
        if (!entry.promise && entry.expires <= now) s.delete(key);
    }
}

/**
 * How long an answer stays fresh: a fixed number of milliseconds, or a
 * function of the payload for an endpoint that declares its own window.
 * `/api/v1/public-settings` does exactly that, and an operator sets it.
 */
type Freshness<T> = number | ((value: T) => number);

/**
 * Fetch `url` as JSON, sharing the request with anything else asking for the
 * same URL at the same time, and the answer for as long as `ttl` says.
 *
 * A failure is not cached: the entry is dropped so the next caller retries
 * rather than inheriting an error for a minute.
 */
export function sharedJson<T = unknown>(url: string, ttl: Freshness<T> = DEFAULT_TTL_MS): Promise<T> {
    const s = store();
    const now = Date.now();
    sweep(s, now);
    const hit = s.get(url);

    if (hit) {
        if (hit.promise) return hit.promise as Promise<T>;
        if (hit.value !== undefined && hit.expires > now) return Promise.resolve(hit.value as T);
    }

    const promise = fetch(url)
        .then((res) => {
            if (!res.ok) throw new Error(`${url} answered ${res.status}`);
            return res.json();
        })
        .then((value: T) => {
            const ms = typeof ttl === "function" ? ttl(value) : ttl;
            s.set(url, { value, expires: Date.now() + (Number.isFinite(ms) ? ms : DEFAULT_TTL_MS) });
            return value;
        })
        .catch((err) => {
            s.delete(url);
            throw err;
        });

    // While the request is in the air the expiry is not consulted; callers
    // are handed the promise itself.
    s.set(url, { promise, expires: now });
    return promise as Promise<T>;
}

/**
 * The answer for `url` if it is already known and still fresh.
 *
 * A component holding a value it can render on its first pass should render
 * it: discovering it a tick later means a blank frame, and a blank frame
 * moves everything below it.
 */
export function peekShared<T = unknown>(url: string): T | undefined {
    const hit = store().get(url);
    if (!hit || hit.value === undefined) return undefined;
    return hit.expires > Date.now() ? (hit.value as T) : undefined;
}

/**
 * Hold `value` as the answer for `url`, as if it had just been fetched.
 *
 * For an answer the server already put in the page: the first caller then
 * reads it instead of asking again. An entry already fresh or in flight is
 * left alone, because it is at least as new as anything the page carried.
 *
 * Browser only. On the server this store is one object for every request the
 * process serves, and a value written there would outlive the request.
 */
export function seedShared(url: string, value: unknown, ttlMs: number): void {
    if (typeof window === "undefined") return;
    const s = store();
    const hit = s.get(url);
    if (hit && (hit.promise || (hit.value !== undefined && hit.expires > Date.now()))) return;
    s.set(url, { value, expires: Date.now() + ttlMs });
}

/** Drop one URL, or everything when called with no argument. */
export function invalidateShared(url?: string): void {
    if (url === undefined) store().clear();
    else store().delete(url);
}
