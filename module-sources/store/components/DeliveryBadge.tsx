/**
 * Where a delivery stands, as a small badge beside an order or a line. It is
 * drawn only when a module answered for the delivery: a site that runs its
 * commands at once has nothing to wait for and shows nothing.
 */
import type { ReactElement } from "react";
import { Badge, type BadgeTone } from "@/core/sdk/ui";

const TONE: Record<DeliveryState, BadgeTone> = {
    waiting: "warning",
    delivered: "success",
    failed: "danger",
    review: "danger",
    cancelled: "neutral",
};

export function DeliveryBadge({ state, label }: { state: DeliveryState | null | undefined; label: (state: DeliveryState) => string }): ReactElement | null {
    if (!state) return null;
    return <Badge tone={TONE[state]}>{label(state)}</Badge>;
}
