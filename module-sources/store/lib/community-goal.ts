/**
 * The community goal: a target the operator sets, and what completed orders
 * have raised toward it this month.
 *
 * Read by the public banner and by a game that shows the same progress, from
 * here, so the two cannot disagree.
 */
import { textFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

export interface CommunityGoalState {
    target: number;
    current: number;
    title: string;
    endDate: string | null;
}

/**
 * `locale` reads a title the operator wrote per language in the reader's,
 * and in the original where it has none. A game asks with none: it has no
 * reader's language to ask in, so it is given the original.
 */
export async function readCommunityGoal(now: Date = new Date(), locale = ""): Promise<CommunityGoalState> {
    const settings = await prisma.setting.findMany({
        where: { key: { startsWith: "community_goal_" } },
        take: 20,
    });
    const settingsMap: Record<string, unknown> = {};
    for (const s of settings) settingsMap[s.key] = s.value;

    const target = Number(settingsMap.community_goal_target) || 0;
    const title = textFor(settingsMap.community_goal_title, locale) || "Monthly Goal";
    const endDate = (settingsMap.community_goal_end_date as string) || null;
    if (target <= 0) return { target: 0, current: 0, title, endDate: null };

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const result = await prisma.order.aggregate({
        _sum: { total: true },
        where: { status: "COMPLETED", createdAt: { gte: monthStart } },
    });
    return { target, current: Number(result._sum.total) || 0, title, endDate };
}
