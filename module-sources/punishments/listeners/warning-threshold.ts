/**
 * Listens to `user.warning.threshold`: enough warning points to act on.
 *
 * Core has counted warning points for a long time and has fired this action at
 * 3, 5 and 10 points for just as long. Nothing listened. Its own comment in
 * `warnings.ts` said what was supposed to happen - "auto-mute at 5 points,
 * auto-ban at 10" - and a moderator watching the number climb had to do it by
 * hand, on a different screen, in a different module, which is why nobody did.
 *
 * The thresholds are core's and this module does not get to invent its own:
 * listening to a number core does not fire would be a rule that never runs.
 * What this decides is what each one means here, and the mapping is the one
 * core already wrote down.
 *
 * Written through the same socket a game server reports through, for the same
 * reason: this module owns the record, and everything that lands in it arrives
 * the same way, so a punishment raised from a warning count is a punishment
 * like any other - it shows on the list, it restricts the same things, and a
 * moderator lifts it from the same screen.
 *
 * `site` is reserved for what an administrator typed here, so these are filed
 * under this module's own name with the warning count as the reference: enough
 * to be idempotent, because core fires a threshold exactly once as it is
 * crossed, and a redelivery updates the row it already made rather than piling
 * a second mute on somebody.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { applyFiltersAsync } from "@/core/sdk";
import { log } from "@/core/sdk/server";

/** What core's own documented intent maps to. */
const AT_THRESHOLD: Record<number, { type: string; duration: string | null; hours: number | null }> = {
    3: { type: "tempMute", duration: "24h", hours: 24 },
    5: { type: "tempMute", duration: "7d", hours: 24 * 7 },
    10: { type: "ban", duration: null, hours: null },
};

const onWarningThreshold: HookHandlerFor<"user.warning.threshold", "action"> = async (payload) => {
    const rule = AT_THRESHOLD[payload.threshold];
    // A threshold this module has no opinion about is not a failure. Core may
    // fire one that predates this file or comes after it.
    if (!rule) return;

    const expiresAt = rule.hours === null
        ? null
        : new Date(Date.now() + rule.hours * 3_600_000).toISOString();

    const outcome = await applyFiltersAsync("punishment.record", { recorded: false, id: null }, {
        source: "punishments.warnings",
        externalRef: `threshold:${payload.userId}:${payload.threshold}`,
        userId: payload.userId,
        // The record shows a name, and this one is against a member rather
        // than against somebody seen on a game server, so the id stands in
        // until the row is drawn beside the account it belongs to.
        playerName: payload.userId,
        type: rule.type,
        reason: "warningPoints",
        duration: rule.duration,
        punishedBy: null,
        expiresAt,
        active: true,
    });

    if (!outcome.recorded) {
        // Loud, because the member was told they were being warned and the
        // consequence silently did not happen.
        log.warn("[punishments] a warning threshold did not produce a punishment", {
            threshold: payload.threshold,
            points: payload.points,
        });
    }
};

export default onWarningThreshold;
