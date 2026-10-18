// @vitest-environment node
/**
 * A buyer reads where a delivery stands on their order, so the summary must
 * never say "delivered" while any part of it is not.
 */
import { describe, it, expect } from "vitest";
import { summarise } from "@/modules/game-connect/lib/order-delivery";

const job = (order: string, line: string, state: string, place = 0) => ({
    referenceId: order,
    groupKey: `order:${order}:${line}:${place}`,
    state,
});

describe("an order's delivery", () => {
    it("is waiting while any line waits, and each line says its own", () => {
        const summary = summarise([job("o1", "a", "DONE"), job("o1", "b", "PENDING"), job("o1", "b", "DONE", 1)]);

        expect(summary.o1).toEqual({ state: "waiting", lines: { a: "delivered", b: "waiting" } });
    });

    it("puts a job a person has to check above a failed one", () => {
        const summary = summarise([job("o1", "a", "FAILED"), job("o1", "b", "NEEDS_REVIEW")]);

        expect(summary.o1.state).toBe("review");
    });

    it("is delivered only when every job ran", () => {
        expect(summarise([job("o1", "a", "DONE"), job("o1", "b", "CLAIMED")]).o1.state).toBe("waiting");
        expect(summarise([job("o1", "a", "DONE"), job("o1", "b", "DONE")]).o1.state).toBe("delivered");
    });

    it("leaves out an order with no queued job", () => {
        expect(summarise([{ referenceId: null, groupKey: "manual:x:y:0", state: "DONE" }])).toEqual({});
    });
});
