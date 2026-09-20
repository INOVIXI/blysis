/**
 * Answers `core.webhook.delivered`: one row per webhook this site sent.
 *
 * This module read the table, searched it, paged it and expired it after
 * thirty days, and nothing anywhere ever inserted a row. The screen could only
 * ever answer "no" to "did the alert go out at three?", and a seed would have
 * read as proof that deliveries were being recorded.
 *
 * Core announces; this writes. Core does not know the table's name, which is
 * why the announcement is a hook rather than a call.
 *
 * Nothing here keeps a copy of what was sent. The body is built from the event
 * and is reconstructible; what an operator needs when a delivery fails is what
 * the receiver said, and that is `response`. The address arrives already cut
 * to its origin - a webhook URL is a credential, and this table is listed,
 * searched and kept for a month.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { log, prisma } from "@/core/sdk/server";

const onWebhookDelivered: HookHandlerFor<"core.webhook.delivered", "action"> = async (delivery) => {
    try {
        await prisma.webhookLog.create({
            data: {
                event: delivery.event,
                url: delivery.url,
                status: delivery.status,
                response: delivery.detail,
            },
        });
    } catch (err) {
        // A log that cannot be written must not turn a webhook that worked
        // into a request that failed. The bus isolates a throwing listener
        // anyway; this is so the reason reaches somebody.
        log.error("[webhook-logs] a delivery could not be written down", {
            event: delivery.event,
            error: err instanceof Error ? err.message : String(err),
        });
    }
};

export default onWebhookDelivered;
