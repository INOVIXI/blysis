/**
 * What the moderation queue does with an answer, whoever gave it.
 *
 * A moderator's button and, later, a reviewing module both end here, so the
 * rules are the same for both: an item is decided only if the answer changes
 * it, every change is recorded with its reason, and the person who wrote the
 * item hears about it through `moderation.item.rejected` (and
 * `moderation.item.restored` when a rejection is taken back), which a
 * notifications module can turn into a message.
 *
 * A provider without `read` cannot say what state an item is in or who
 * wrote it. Its items are decided as asked and recorded, and nobody is told.
 */
import { prisma } from "@/core/lib/db";
import { doActionAsync } from "@/core/lib/hooks";
import { listReasons } from "@/core/lib/moderation-reasons";
import type { ModerationProvider, ModerationState } from "@/core/generated/module-moderation";

export interface DecisionInput {
    ids: string[];
    state: ModerationState;
    reasonId?: string | null;
    note?: string | null;
    /** The member who decided; null for a reviewing module. */
    decidedById?: string | null;
    /** The module that decided, when no person did. */
    reviewer?: string | null;
    /**
     * The author asked a person to look at it (`moderation-ask-person.ts`).
     * Recorded so no reviewer touches the item again, and announced to
     * nobody: the author did it themselves.
     */
    humanOnly?: boolean;
}

export interface DecisionView {
    reason: string | null;
    note: string | null;
    decidedBy: { id: string; username: string } | null;
    reviewer: string | null;
    /** The author asked a person to look at it; no reviewer will again. */
    humanOnly: boolean;
    decidedAt: Date;
}

export async function decide(
    provider: { id: string; impl: ModerationProvider },
    input: DecisionInput,
): Promise<{ affected: string[] }> {
    const { impl } = provider;
    const before = impl.read ? await impl.read(input.ids) : null;
    const changing = before
        ? before.filter((item) => item.state !== input.state)
        : input.ids.map((id) => ({ id, authorId: null, state: null }));
    if (changing.length === 0) return { affected: [] };

    const ids = changing.map((item) => item.id);
    await impl.bulkUpdate(ids, input.state);

    const recorded = await prisma.moderationDecision.createManyAndReturn({
        data: ids.map((itemId) => ({
            provider: provider.id,
            itemId,
            state: input.state,
            reasonId: input.state === "REJECTED" ? input.reasonId ?? null : null,
            note: input.note ?? null,
            decidedById: input.decidedById ?? null,
            reviewer: input.reviewer ?? null,
            humanOnly: input.humanOnly === true,
        })),
        select: { id: true, itemId: true },
    });
    const decisionOf = new Map(recorded.map((row) => [row.itemId, row.id]));

    for (const item of changing) {
        if (!item.authorId || input.humanOnly) continue;
        const decisionId = decisionOf.get(item.id);
        if (!decisionId) continue;
        const payload = { provider: provider.id, itemId: item.id, authorId: item.authorId, decisionId };
        if (input.state === "REJECTED") {
            await doActionAsync("moderation.item.rejected", payload);
        } else if (item.state === "REJECTED") {
            await doActionAsync("moderation.item.restored", payload);
        }
    }

    return { affected: ids };
}

/**
 * Each item's most recent decision, its reason worded for `locale`. A
 * reason the admin has since switched off still reads as what it was.
 */
export async function latestDecisions(
    providerId: string,
    itemIds: string[],
    locale: string,
): Promise<Map<string, DecisionView>> {
    const out = new Map<string, DecisionView>();
    if (itemIds.length === 0) return out;
    const [rows, reasons] = await Promise.all([
        prisma.moderationDecision.findMany({
            where: { provider: providerId, itemId: { in: itemIds } },
            orderBy: { createdAt: "desc" },
            select: {
                itemId: true,
                reasonId: true,
                note: true,
                reviewer: true,
                humanOnly: true,
                createdAt: true,
                decidedBy: { select: { id: true, username: true } },
            },
        }),
        listReasons(locale, { includeDisabled: true }),
    ]);
    const labelOf = new Map(reasons.map((reason) => [reason.id, reason.label]));
    for (const row of rows) {
        if (out.has(row.itemId)) continue;
        out.set(row.itemId, {
            reason: row.reasonId ? labelOf.get(row.reasonId) ?? null : null,
            note: row.note,
            decidedBy: row.decidedBy,
            reviewer: row.reviewer,
            humanOnly: row.humanOnly === true,
            decidedAt: row.createdAt,
        });
    }
    return out;
}
