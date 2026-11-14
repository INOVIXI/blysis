import { prisma } from "@/core/sdk/server";
import { readConfig } from "../lib/settings";

/**
 * Forgets the assistant's drafts after the operator's retention window. A
 * message it sent stays on the ticket: that belongs to the conversation, and
 * the draft row was only the record of how it came to be.
 */
export default async function pruneAiSupportDrafts(): Promise<void> {
    const { retentionDays } = await readConfig();
    await prisma.aiSupportDraft.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - retentionDays * 86_400_000) } },
    });
}
