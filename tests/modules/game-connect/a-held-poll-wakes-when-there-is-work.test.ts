// @vitest-environment node
/**
 * A held long-poll answers the moment there is work, not at the end of its
 * hold, and lets go of a request whose caller has gone.
 */
import { describe, it, expect } from "vitest";

const { wake, waitForWake } = await import("@/modules/game-connect/lib/wake");

describe("waiting for work", () => {
    it("ends when the server is woken", async () => {
        const waiting = waitForWake("g1", 10_000);
        wake("g1");
        await expect(waiting).resolves.toBe("woken");
    });

    it("is woken by a wake for every server", async () => {
        const waiting = waitForWake("g1", 10_000);
        wake(null);
        await expect(waiting).resolves.toBe("woken");
    });

    it("is not woken by a wake for another server", async () => {
        const waiting = waitForWake("g1", 50);
        wake("g2");
        await expect(waiting).resolves.toBe("timeout");
    });

    it("lets go when the caller goes", async () => {
        const controller = new AbortController();
        const waiting = waitForWake("g1", 10_000, controller.signal);
        controller.abort();
        await expect(waiting).resolves.toBe("aborted");
    });
});
