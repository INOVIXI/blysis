/**
 * Where an order's queued deliveries stand, in the words a buyer is shown.
 *
 * A line is the order item a job was queued for, read from the job's group
 * key, which the store writes as `order:<order>:<line>:<place>`. The worst job
 * of a line decides it: one that a person has to check outweighs one that
 * failed, which outweighs one still waiting, so a buyer is never told
 * "delivered" while any part of it is not.
 */
export type DeliveryState = "waiting" | "delivered" | "failed" | "review" | "cancelled";

const WORST_FIRST: DeliveryState[] = ["review", "failed", "waiting", "delivered", "cancelled"];

const STATE_OF: Record<string, DeliveryState> = {
    PENDING: "waiting",
    CLAIMED: "waiting",
    DONE: "delivered",
    FAILED: "failed",
    NEEDS_REVIEW: "review",
    CANCELLED: "cancelled",
};

export interface DeliveryJob {
    referenceId: string | null;
    groupKey: string;
    state: string;
}

function worst(states: DeliveryState[]): DeliveryState {
    return WORST_FIRST.find((state) => states.includes(state)) ?? "waiting";
}

/** One order's state and each line's, for every order that has a queued job. */
export function summarise(jobs: DeliveryJob[]): Record<string, { state: DeliveryState; lines: Record<string, DeliveryState> }> {
    const byOrder = new Map<string, Map<string, DeliveryState[]>>();
    for (const job of jobs) {
        if (!job.referenceId) continue;
        const line = job.groupKey.split(":")[2] ?? "line";
        const lines = byOrder.get(job.referenceId) ?? new Map<string, DeliveryState[]>();
        lines.set(line, [...(lines.get(line) ?? []), STATE_OF[job.state] ?? "waiting"]);
        byOrder.set(job.referenceId, lines);
    }
    const out: Record<string, { state: DeliveryState; lines: Record<string, DeliveryState> }> = {};
    for (const [order, lines] of byOrder) {
        const each: Record<string, DeliveryState> = {};
        for (const [line, states] of lines) each[line] = worst(states);
        out[order] = { state: worst(Object.values(each)), lines: each };
    }
    return out;
}
