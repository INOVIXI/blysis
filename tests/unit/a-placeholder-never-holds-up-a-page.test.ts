// @vitest-environment node
/**
 * Site placeholders are asked for on every page, so none of them may hold one
 * up or take it down.
 *
 * Each is asked through the cache for as long as its module says its value
 * keeps, and raced against the time the caller can spare: one that is not
 * ready by then is left for the browser to ask again, and goes on to fill the
 * cache for the next page. One that throws answers nothing, for itself alone.
 * A switched-off module's are not asked at all, and "no value" is remembered
 * like any value, so a site with no game server does not ask on every page
 * why it has none.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Handler = () => Promise<unknown>;

const state = vi.hoisted(() => ({
    handlers: {} as Record<string, () => Promise<unknown>>,
    calls: {} as Record<string, number>,
    states: {} as Record<string, boolean>,
    store: new Map<string, unknown>(),
}));

function source(name: string, maxAgeSeconds = 60) {
    const [module] = name.split(".");
    return {
        name, module, labelKey: `placeholder_${name}`, example: null, maxAgeSeconds,
        loader: async () => ({
            default: async () => {
                state.calls[name] = (state.calls[name] ?? 0) + 1;
                return state.handlers[name]();
            },
        }),
    };
}

vi.mock("@/core/generated/module-placeholders", () => ({
    get ModulePlaceholders() {
        return ["servers.online", "servers.motd", "servers.slow", "servers.broken", "vote.total"].map((n) => source(n));
    },
}));
vi.mock("@/core/lib/core-placeholders", () => ({
    CORE_PLACEHOLDERS: [{ ...source("site.name"), module: "core" }],
}));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates: async () => state.states }));
vi.mock("@/core/lib/cache", () => ({
    cached: async (key: string, _ttl: number, loader: () => Promise<unknown>) => {
        if (state.store.has(key)) return state.store.get(key);
        const fresh = await loader();
        state.store.set(key, fresh);
        return fresh;
    },
}));
vi.mock("@/core/lib/logger", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    errorText: (e: unknown) => String(e),
}));

const { resolvePlaceholders } = await import("@/core/lib/placeholders");

const never: Handler = () => new Promise(() => {});

beforeEach(() => {
    state.calls = {};
    state.store.clear();
    state.states = { servers: true, vote: false };
    state.handlers = {
        "servers.online": async () => 214,
        "servers.motd": async () => `  ${"x".repeat(300)}  `,
        "servers.slow": never,
        "servers.broken": async () => { throw new Error("socket closed"); },
        "vote.total": async () => 9,
        "site.name": async () => "Kayadibi",
    };
});

describe("site placeholders on a page", () => {
    it("answers what is ready in time and leaves the rest pending", async () => {
        const { values, pending } = await resolvePlaceholders({ budgetMs: 50 });
        expect(values["servers.online"]).toBe(214);
        expect(values["site.name"]).toBe("Kayadibi");
        expect(pending).toEqual(["servers.slow"]);
        expect("servers.slow" in values).toBe(false);
    });

    it("answers nothing for one that throws, and only for that one", async () => {
        const { values } = await resolvePlaceholders({ budgetMs: 50 });
        expect(values["servers.broken"]).toBeNull();
        expect(values["servers.online"]).toBe(214);
    });

    it("does not ask a switched-off module", async () => {
        const { values, pending } = await resolvePlaceholders({ budgetMs: 50 });
        expect("vote.total" in values).toBe(false);
        expect(pending).not.toContain("vote.total");
        expect(state.calls["vote.total"]).toBeUndefined();
    });

    it("keeps a value, an empty one too, for as long as it keeps", async () => {
        state.handlers["servers.online"] = async () => null;
        await resolvePlaceholders({ budgetMs: 50 });
        const { values } = await resolvePlaceholders({ budgetMs: 50 });
        expect(values["servers.online"]).toBeNull();
        expect(state.calls["servers.online"]).toBe(1);
    });

    it("holds a value to plain text or a number", async () => {
        state.handlers["servers.online"] = async () => Number.NaN;
        const { values } = await resolvePlaceholders({ budgetMs: 50 });
        expect(values["servers.online"]).toBeNull();
        expect(values["servers.motd"]).toBe("x".repeat(200));
    });
});
