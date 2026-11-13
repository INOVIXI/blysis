/**
 * What the author of a moderated item is shown about it.
 *
 * A rejected post used to vanish from under its author with no word. The
 * notification a rejection sends links here, and this says what happened and
 * why, in the reader's language, and quotes enough of the post to recognise
 * it. The moderators' note is theirs and never leaves the panel.
 *
 * Only the author is answered. A stranger, an item that does not exist and a
 * kind whose module cannot read its items all get the same null, so the page
 * says nothing about what anybody else wrote or whether it exists.
 */
import { ModuleModerationProviders, type ModerationState } from "@/core/generated/module-moderation";
import { getModuleStates } from "@/core/lib/module-cache";
import { latestDecisions } from "@/core/lib/moderation-decisions";

/** How much of the post the page quotes back. */
const EXCERPT = 500;

export interface ModerationNotice {
    title?: string;
    excerpt: string;
    state: ModerationState;
    reason: string | null;
    decidedAt: string | null;
    href?: string;
}

export async function readNotice(
    providerId: string,
    itemId: string,
    userId: string,
    locale: string,
): Promise<ModerationNotice | null> {
    const provider = ModuleModerationProviders.find((p) => p.id === providerId);
    if (!provider) return null;
    const states = await getModuleStates();
    if (states[provider.module] === false) return null;

    const impl = (await provider.loader()).default;
    if (!impl.read) return null;
    const [item] = await impl.read([itemId]);
    if (!item || !item.authorId || item.authorId !== userId) return null;

    const decision = (await latestDecisions(providerId, [itemId], locale)).get(itemId);
    return {
        title: item.title,
        excerpt: item.body.slice(0, EXCERPT),
        state: item.state,
        reason: decision?.reason ?? null,
        decidedAt: decision ? decision.decidedAt.toISOString() : null,
        href: item.href,
    };
}
