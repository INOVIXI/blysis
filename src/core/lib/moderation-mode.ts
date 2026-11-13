/**
 * Whether what a person just wrote is published at once or waits in the
 * moderation queue.
 *
 * Every module that publishes what a stranger wrote asks this, with the key
 * its `moderationProviders` entry names as `settingKey`. The admin's answer
 * lives in the `moderation` setting the moderation settings screen writes.
 * Anything that is not a mode this function knows publishes, which is how
 * every site behaved before an admin opened that screen.
 *
 * It was four copies in three modules until a reviewing mode was about to be
 * added: `tests/unit/one-answer-decides-whether-a-post-waits.test.ts` keeps
 * any module from deciding for itself again.
 */
import { prisma } from "@/core/lib/db";

export type ModerationState = "PENDING" | "APPROVED";

export async function moderationStateFor(settingKey: string): Promise<ModerationState> {
    const setting = await prisma.setting.findUnique({ where: { key: "moderation" } });
    const value = setting?.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return "APPROVED";
    const mode = (value as Record<string, unknown>)[settingKey];
    return mode === "manual" ? "PENDING" : "APPROVED";
}
