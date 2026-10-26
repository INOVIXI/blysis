import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A module's hook listener that throws on the server is logged where the
 * request that ran it can be found again.
 *
 * The hook bus is re-exported through the isomorphic SDK, so it may not import
 * the logger, and it reported a failed listener with `console.error`: one bare
 * line with no correlation id, from the place a module's code fails most. The
 * server's bootstrap now hands the bus the logger; a browser, which has
 * nothing else, keeps the console.
 */

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/core/lib/logger", () => ({
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: logError },
}));
vi.mock("@/core/lib/activity-feed", () => ({ registerActivityFeedListeners: () => {} }));
vi.mock("@/core/generated/module-hooks", () => ({ ModuleHookListeners: [] }));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates: async () => ({}) }));

import { addAction, doAction, resetHooks } from "@/core/lib/hooks";
import { bootstrapHooks } from "@/core/lib/hooks-bootstrap";

describe("a listener that throws", () => {
    beforeEach(() => {
        resetHooks();
        logError.mockReset();
    });

    it("is told to the console where nothing booted the server's bus", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        addAction("order.paid", () => { throw new Error("gateway down"); });
        doAction("order.paid", null);
        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(logError).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it("is logged, by hook and reason, once the server booted the bus", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        await bootstrapHooks();
        addAction("order.paid", () => { throw new Error("gateway down"); });
        doAction("order.paid", null);
        expect(logError).toHaveBeenCalledWith('[hooks] Action "order.paid" listener failed', { error: "gateway down" });
        expect(consoleError).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it("goes back to the console when the bus is reset", async () => {
        await bootstrapHooks();
        resetHooks();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        addAction("order.paid", () => { throw new Error("gateway down"); });
        doAction("order.paid", null);
        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(logError).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
