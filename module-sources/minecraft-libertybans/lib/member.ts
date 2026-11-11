/**
 * Which member a punished player is, when this site knows.
 *
 * The question goes out as `game-account.resolve`, and the modules that answer
 * it look the UUID up first and fall back to the name only when no UUID is
 * given. That is right for a server in online mode, where the UUID is the
 * account and a name can pass from one owner to the next.
 *
 * A server in offline mode has no accounts. Its UUID is derived from the name
 * the player typed (`offlineUuid`), so the name is the identity and the UUID is
 * just its fingerprint, and a member linked under that name may well be stored
 * with a different UUID: whatever the link looked up, not what this server
 * made up. Asking with the UUID would then never find them.
 *
 * So the UUID is asked first, exactly as it is, and only when nobody answers
 * and the UUID is precisely the offline one for the name LibertyBans last saw
 * it under is the name asked on its own. That condition is what keeps it safe
 * on an online server: a Mojang UUID is never the MD5 of a name, so the second
 * question is never asked there. No setting is needed to say which kind of
 * server this is; every row says it.
 *
 * A name nobody linked answers null, and the punishment is recorded against
 * the name without a member. `member.standing` only counts a row with a
 * member, so this never lets a name restrict an account its owner did not
 * prove.
 */

import { applyFiltersAsync } from "@/core/sdk";
import { offlineUuid } from "./uuid";

export async function memberFor(playerUuid: string | null, playerName: string): Promise<string | null> {
    const exact = await applyFiltersAsync(
        "game-account.resolve",
        { userId: null },
        { uuid: playerUuid, username: playerName, platform: "minecraft" },
    );
    if (exact.userId) return exact.userId;

    // A name LibertyBans never saw is the UUID standing in for it, and its
    // offline UUID is not that UUID, so it does not get here.
    if (!playerUuid || offlineUuid(playerName) !== playerUuid) return null;

    const byName = await applyFiltersAsync(
        "game-account.resolve",
        { userId: null },
        { uuid: null, username: playerName, platform: "minecraft" },
    );
    return byName.userId ?? null;
}
