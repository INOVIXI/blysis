/**
 * Moving a stored hash to the algorithm the site now wants, at the one moment
 * that can: a sign-in that has just proven the password. A password exists in
 * this process only while somebody is typing it, so there is no later chance.
 *
 * A hash made by the site's other algorithm is rewritten in the background,
 * and its failure is not the member's problem: a write that does not land
 * leaves the old hash, which still verifies, and the next sign-in tries again.
 *
 * An imported hash (`legacy-password-hash.ts`) is waited for. It is a fast
 * hash kept only until its owner signs in, so the sign-in that proves the
 * password is the one that removes it, rather than a background write that
 * may still be pending when somebody copies the table. A failure still does
 * not refuse the sign-in; the next one tries again.
 */

import { prisma } from "@/core/lib/db";
import { isLegacyPasswordHash } from "@/core/lib/legacy-password-hash";
import { hashPassword, needsRehash } from "@/core/lib/password-hash";
import { getHashAlgorithm } from "@/core/lib/security-settings";

export async function upgradeStoredHash(userId: string, password: string, stored: string): Promise<void> {
    const wanted = await getHashAlgorithm();
    if (!needsRehash(stored, wanted)) return;

    const moving = (async () => {
        const moved = await hashPassword(password, wanted);
        // Only over the hash that was checked: a password changed in the
        // meantime is newer than this one and stays.
        await prisma.user.updateMany({ where: { id: userId, password: stored }, data: { password: moved } });
    })().catch(() => { /* Old hash stands. Tried again next time. */ });

    if (isLegacyPasswordHash(stored)) await moving;
}
