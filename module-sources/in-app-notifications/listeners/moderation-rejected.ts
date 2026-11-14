import { shouldNotify } from "@/core/sdk/server";
import { createNotification } from "../lib/notifications";

/**
 * Hook listener: `moderation.item.rejected`, which core fires for whoever
 * wrote something the moderation queue rejected, whichever module holds it.
 *
 * A rejected post used to vanish with no word to its author. The message says
 * only that it was not published and links to the page that says why: the
 * reason is not copied in, because this row is stored once and that page
 * shows it in whatever language the author reads it in.
 */
export default async function onModerationRejected(payload: {
    provider: string;
    itemId: string;
    authorId: string;
    decisionId: string;
}): Promise<void> {
    const recipient = payload?.authorId;
    if (!recipient) return;
    if (!(await shouldNotify(recipient, "moderation.item.rejected", "inapp"))) return;
    await createNotification({
        userId: recipient,
        title: "Your post was not published",
        message: "It was rejected. Open it to see why.",
        titleKey: "notif_moderationRejectedTitle",
        messageKey: "notif_moderationRejectedMessage",
        type: "warning",
        href: `/moderation/${encodeURIComponent(payload.provider)}/${encodeURIComponent(payload.itemId)}`,
    });
}
