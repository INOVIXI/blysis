/**
 * Saying that a webhook went out, without saying how to send one.
 *
 * `WebhookLog` belongs to a module. Core may not name it, and core is where
 * the two deliveries it makes happen: the health alert on a schedule, and the
 * same call behind the panel's test button. Measured on 2026-09-20 the table
 * was read, searched, paged and expired after thirty days by its module, and
 * *nothing anywhere ever inserted a row* - so the screen could only ever
 * answer "no" to "did the alert go out at three?".
 *
 * So core announces the delivery and whatever keeps the log writes it. Any
 * module that sends one of its own announces the same way.
 *
 * ## The address is a credential
 *
 * This is the load-bearing part rather than a nicety. A webhook URL is the
 * key: Discord's is `https://discord.com/api/webhooks/<id>/<token>`, and
 * anyone holding it can post to that channel. A log is listed, searched,
 * paged and kept for a month - longer than the key it would hold, if it held
 * one. So only the origin is recorded. Which receiver it was is answered by
 * the event beside it, which is the question an operator is actually asking.
 */
import { errorText, log } from "./logger";

/** Enough of a receiver's answer to act on, and not a page of HTML. */
const MAX_DETAIL = 500;

export interface WebhookDelivery {
    /** What the delivery was for, in the sender's own words. */
    event: string;
    /** The address as it was called. Redacted before it goes anywhere. */
    url: string;
    /** The HTTP status, or 0 when the request never got an answer at all. */
    status: number;
    ok: boolean;
    /** What the receiver said, or why the request failed. */
    detail: string | null;
}

/**
 * The origin, and nothing else. A token is never in an origin, and a query
 * string is where a key goes when it is not in the path.
 *
 * An address that cannot be parsed is recorded as nothing rather than as
 * itself: a string that is not a URL is a string nobody checked, and guessing
 * which part of it was secret is the wrong way round.
 */
export function redactWebhookTarget(url: string): string {
    try {
        return new URL(url).origin;
    } catch {
        return "";
    }
}

/**
 * The same redaction, applied to whatever the receiver said.
 *
 * A failure detail is not a safe place either: `fetch` names the address it
 * could not reach, and a receiver that refuses a request sometimes quotes it
 * back. So every address inside the text is cut down to its origin too. The
 * test that found this was the one asserting the token appears nowhere,
 * which it did - in the detail rather than the url.
 */
function redactAddressesIn(detail: string): string {
    return detail.replace(/https?:\/\/[^\s"'<>]+/g, (found) => redactWebhookTarget(found) || "");
}

/**
 * Announce a delivery. Never throws: a log that cannot be written must not
 * turn a webhook that worked into a request that failed.
 */
export async function recordWebhookDelivery(delivery: WebhookDelivery): Promise<void> {
    try {
        const { ensureHooks } = await import("./hooks-bootstrap");
        await ensureHooks();
        const { doActionAsync } = await import("./hooks");
        await doActionAsync("core.webhook.delivered", {
            event: delivery.event,
            url: redactWebhookTarget(delivery.url),
            status: delivery.status,
            ok: delivery.ok,
            detail: delivery.detail ? redactAddressesIn(delivery.detail).slice(0, MAX_DETAIL) : null,
        });
    } catch (err) {
        log.warn("[webhook] the delivery could not be recorded", { error: errorText(err) });
    }
}
