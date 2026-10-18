/**
 * Answers `game-account.resolve`: which member owns this in-game name.
 *
 * The UUID is tried first because it survives a rename and the name does not.
 * A name that nobody has linked answers null, which the caller treats as "no
 * member yet" rather than as a failure. Asked about another game, it does not
 * answer: its accounts are Minecraft accounts.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

const resolveGameAccount: HookHandlerFor<"game-account.resolve", "filter"> = async (current, lookup) => {
    if (current?.userId) return current;
    if (lookup?.platform && lookup.platform !== "minecraft") return current ?? { userId: null };
    if (!lookup?.uuid && !lookup?.username) return { userId: null };

    const account = await prisma.minecraftAccount.findFirst({
        where: lookup.uuid
            ? { uuid: lookup.uuid }
            : { username: { equals: lookup.username as string, mode: "insensitive" } },
        select: { userId: true },
    });

    return { userId: account?.userId ?? null };
};

export default resolveGameAccount;
