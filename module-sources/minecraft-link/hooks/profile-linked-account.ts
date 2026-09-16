/**
 * Answers `profile.linkedAccounts`: the Minecraft account this member proved.
 *
 * Proved, not claimed: the binding exists only where a code was whispered to
 * that account in game and typed back on the site. The profile module asks
 * because it cannot check anything itself, and before it asked it kept a
 * self-declared name instead.
 *
 * No avatar. A head render is a third party's URL built from a name, and a
 * picture the site did not receive with the identity is not the identity's.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

const linkedAccount: HookHandlerFor<"profile.linkedAccounts", "filter"> = async (current, who) => {
    if (!who?.userId) return current;

    const account = await prisma.minecraftAccount.findUnique({
        where: { userId: who.userId },
        select: { username: true },
    });
    if (!account) return current;

    return [...current, { provider: "minecraft", username: account.username, avatar: null }];
};

export default linkedAccount;
