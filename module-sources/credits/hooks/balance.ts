/** Answers `credits.balance`: what a member holds now. */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

const balance: HookHandlerFor<"credits.balance", "filter"> = async (_current, { userId }) => {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { creditBalance: true } });
    return row ? Number(row.creditBalance) : null;
};

export default balance;
