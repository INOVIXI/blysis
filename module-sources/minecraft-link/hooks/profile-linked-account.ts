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
import { prisma } from "@/core/sdk/server";

/**
 * An account a profile shows as proved.
 *
 * Stated here rather than taken from `HookHandlerFor<"profile.linkedAccounts">`:
 * that shape is declared by member-profiles, and a site that installs this module
 * without it still builds this file. Without the declaration the hook's types
 * fall back to `unknown`, and the reads below failed the whole site's build.
 * With both installed, `npm run typecheck:modules` holds these against the
 * declared contract.
 */
interface LinkedAccount {
    provider: string;
    username: string | null;
    avatar: string | null;
}

const linkedAccount = async (current: LinkedAccount[], who?: { userId: string }): Promise<LinkedAccount[]> => {
    if (!who?.userId) return current;

    const account = await prisma.minecraftAccount.findUnique({
        where: { userId: who.userId },
        select: { username: true },
    });
    if (!account) return current;

    return [...current, { provider: "minecraft", username: account.username, avatar: null }];
};

export default linkedAccount;
