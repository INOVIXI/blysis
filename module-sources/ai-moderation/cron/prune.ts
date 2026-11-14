import { prisma } from "@/core/sdk/server";
import { readConfig } from "../lib/settings";

/**
 * Forgets the reviewer's decisions after the operator's retention window.
 * The moderation decision core recorded for each item stays: this is the
 * model's reasoning, kept only as long as somebody may want to check it.
 */
export default async function pruneAiModerationReviews(): Promise<void> {
    const { retentionDays } = await readConfig();
    await prisma.aiModerationReview.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - retentionDays * 86_400_000) } },
    });
}
