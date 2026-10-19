import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    addAction,
    addFilter,
    doActionAsync,
    applyFiltersAsync,
    resetHooks,
} from "@/core/lib/hooks";

describe("hook listener timeout", () => {
    const originalTimeout = process.env.HOOK_LISTENER_TIMEOUT_MS;

    beforeEach(() => {
        process.env.HOOK_LISTENER_TIMEOUT_MS = "200";
        resetHooks();
    });

    afterEach(() => {
        if (originalTimeout === undefined) delete process.env.HOOK_LISTENER_TIMEOUT_MS;
        else process.env.HOOK_LISTENER_TIMEOUT_MS = originalTimeout;
        vi.restoreAllMocks();
    });

    it("returns quickly when an async action listener hangs", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        addAction("test.hang", () => new Promise((resolve) => setTimeout(resolve, 2_000)), {
            moduleId: "pathological",
        });

        let fastCalled = false;
        addAction("test.hang", () => { fastCalled = true; });

        const started = Date.now();
        await doActionAsync("test.hang", {});
        const elapsed = Date.now() - started;

        expect(elapsed).toBeLessThan(1_000);
        expect(fastCalled).toBe(true);
        expect(errorSpy).toHaveBeenCalled();
    });

    it("passes the previous value down the filter chain when a listener times out", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        addFilter("test.chain", (v: string) => v + "a");
        addFilter(
            "test.chain",
            (): Promise<string> => new Promise((resolve) => setTimeout(() => resolve("never"), 2_000)),
            { moduleId: "slow" },
        );
        addFilter("test.chain", (v: string) => v + "c");

        const result = await applyFiltersAsync("test.chain", "");
        expect(result).toBe("ac");
    });

    /**
     * A listener handed the caller's open transaction writes on it, and the
     * caller commits when this returns. Abandoned at the timeout, its writes
     * still landed in that commit while the caller read the default and went
     * on as if nothing had moved. Measured live: twelve credit transfers in a
     * game each answered "insufficient balance" while the sender lost thirteen
     * credits, ten of them with no ledger row, and the recipient got nothing.
     * Such a listener is waited for; a transaction too slow ends at the
     * database's own timeout and rolls back whole.
     */
    it("waits for a filter listener that works on the caller's transaction", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        addFilter(
            "test.money",
            (): Promise<{ applied: boolean }> => new Promise((resolve) => setTimeout(() => resolve({ applied: true }), 400)),
            { moduleId: "wallet" },
        );

        const moved = await applyFiltersAsync("test.money", { applied: false }, { tx: {}, userId: "u1", amount: -1 });

        expect(moved).toEqual({ applied: true });
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("still gives up on a slow filter listener that has no transaction of the caller's", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        addFilter(
            "test.lookup",
            (): Promise<string> => new Promise((resolve) => setTimeout(() => resolve("late"), 400)),
            { moduleId: "slow" },
        );

        await expect(applyFiltersAsync("test.lookup", "default", { userId: "u1" })).resolves.toBe("default");
    });
});
