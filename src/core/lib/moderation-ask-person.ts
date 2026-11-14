/**
 * The author's way back from a reviewing module's rejection: ask a person.
 *
 * A reviewer is a model and can be wrong, and the person it was wrong about
 * is the one who knows. So its rejection carries a button on the author's
 * notice page that puts the item back in the queue, marked `humanOnly`: the
 * review round never hands it over again, and what a person then decides is
 * final. Once per item, because a second ask would be asking the same person
 * the same question.
 *
 * A person's own rejection offers nothing, since a person already looked.
 * `tests/unit/an-author-asks-a-person-once.test.ts` holds each rule.
 */
import { prisma } from "@/core/lib/db";
import { getModuleStates } from "@/core/lib/module-cache";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { decide } from "@/core/lib/moderation-decisions";
import { ModuleModerationProviders } from "@/core/generated/module-moderation";

export interface AskPersonState {
    /** The latest decision is a reviewer's rejection and nobody has asked yet. */
    canAsk: boolean;
    /** The author has asked; a person decides from here. */
    asked: boolean;
}

export async function askPersonState(providerId: string, itemId: string): Promise<AskPersonState> {
    const rows = await prisma.moderationDecision.findMany({
        where: { provider: providerId, itemId },
        orderBy: { createdAt: "desc" },
        select: { state: true, reviewer: true, decidedById: true, humanOnly: true },
    });
    const asked = rows.some((row) => row.humanOnly);
    const latest = rows[0];
    const byReviewer = latest?.state === "REJECTED" && Boolean(latest.reviewer) && !latest.decidedById;
    return { canAsk: !asked && byReviewer, asked };
}

export type AskPersonResult = "ok" | "not_found" | "not_allowed";

export async function askPerson(providerId: string, itemId: string, userId: string): Promise<AskPersonResult> {
    const provider = ModuleModerationProviders.find((p) => p.id === providerId);
    if (!provider) return "not_found";
    if (!isEnabledIn(await getModuleStates(), provider.module)) return "not_found";
    const impl = (await provider.loader()).default;
    if (!impl.read) return "not_found";

    const [item] = await impl.read([itemId]);
    if (!item || !item.authorId || item.authorId !== userId) return "not_found";
    if (item.state !== "REJECTED") return "not_allowed";
    if (!(await askPersonState(providerId, itemId)).canAsk) return "not_allowed";

    await decide({ id: providerId, impl }, { ids: [itemId], state: "PENDING", decidedById: userId, humanOnly: true });
    return "ok";
}
