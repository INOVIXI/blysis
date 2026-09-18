/**
 * Answers `punishment.record`: another module watched something ban somebody,
 * and this module keeps the record.
 *
 * Written as an upsert on (source, externalRef) because the other system will
 * deliver the same event twice - a redelivery, a re-sync after an outage, an
 * operator pressing "read everything again" - and a punishment listed twice is
 * worse than one listed late.
 *
 * A failure comes back as `recorded: false` rather than as an exception. The
 * caller is usually answering an outside system, and a thrown error there
 * turns "we could not write this down" into a 500 that the other system reads
 * as "try the whole batch again".
 *
 * The one thing here that is not idempotent is the announcement, so it follows
 * the *transition* rather than the report. A row that arrives already lifted is
 * history being written down for the first time and says nothing: a first full
 * read of a server with ten years of bans would otherwise be ten years of
 * apologies delivered at once. A row this site holds as standing, which the
 * other system now says is lifted, is the thing that just happened.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { doActionAsync } from "@/core/sdk";
import { log, prisma } from "@/core/sdk/server";

const recordPunishment: HookHandlerFor<"punishment.record", "filter"> = async (current, report) => {
    // Somebody already wrote it down. A second recorder would duplicate it.
    if (current?.recorded) return current;

    if (!report?.source || !report.externalRef || !report.playerName || !report.type) {
        return { recorded: false, id: null };
    }
    // `site` is what an administrator issuing one here is called; a module
    // claiming it would put its rows where a person's are.
    if (report.source === "site") return { recorded: false, id: null };

    /*
     * The reporter names a key, not a scope. `skyblock` or `srv-2` is the
     * other system's word for a place, so it is matched against what the
     * operator has actually named and never turned into a scope on its own -
     * that would put `srv-2` on a public list under a column header. The key
     * is kept either way, so a scope made later can claim these rows.
     */
    const scopeKey = report.scopeKey?.trim() || null;
    const scopeId = scopeKey
        ? (await prisma.punishmentScope.findFirst({ where: { matchKey: scopeKey }, select: { id: true } }))?.id ?? null
        : null;

    const data = {
        userId: report.userId ?? null,
        playerName: report.playerName,
        playerUuid: report.playerUuid ?? null,
        type: report.type,
        reason: report.reason ?? null,
        duration: report.duration ?? null,
        punishedBy: report.punishedBy ?? null,
        expiresAt: report.expiresAt ? new Date(report.expiresAt) : null,
        active: report.active ?? true,
        liftedBy: report.liftedBy ?? null,
        liftReason: report.liftReason ?? null,
        scopeId,
        scopeKey,
    };

    try {
        // Read before the write, because the write is what destroys the
        // answer. A row that is not here yet is history arriving, not news.
        const before = await prisma.punishment.findUnique({
            where: { source_externalRef: { source: report.source, externalRef: report.externalRef } },
            select: { active: true },
        });

        const row = await prisma.punishment.upsert({
            where: { source_externalRef: { source: report.source, externalRef: report.externalRef } },
            update: data,
            create: { ...data, source: report.source, externalRef: report.externalRef },
        });

        if (before?.active === true && data.active === false) {
            // The member hears about this, so it is raised rather than
            // returned: whoever reports a lift should not also have to know
            // which modules care that one happened.
            await doActionAsync("punishments.punishment.revoked", {
                punishmentId: row.id,
                playerName: row.playerName,
                type: row.type,
                userId: row.userId,
                liftedBy: data.liftedBy,
                liftReason: data.liftReason,
            });
        }

        return { recorded: true, id: row.id };
    } catch (error) {
        log.warn("[punishments] a report could not be recorded", {
            source: report.source,
            error: error instanceof Error ? error.message : "unknown",
        });
        return { recorded: false, id: null };
    }
};

export default recordPunishment;
