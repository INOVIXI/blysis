import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * Accounts that have been proved in game.
 *
 * The profile's Accounts tab is a list of what a member has linked, and this
 * module is the only thing that answers it - so with no row anywhere the tab
 * was the empty state on every install and the sentence under it ("links are
 * managed by the module that made them") was the whole screen.
 *
 * A link is normally made by whispering a code to a player who is online, so
 * there is no way to seed one through the real door. These are written
 * straight to the table, which is what the code would have written.
 *
 * The UUID is the Mojang identifier; a made-up one is still a UUID and is
 * still unique per row, which is all anything here reads it for. Nothing
 * calls Mojang with it.
 */

/** In-game names, one per seeded link. */
const NAMES = ["Notchling", "CobbleKing", "RedstoneRae", "EnderPilot", "AxolotlAce", "NetherNell"];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        // The operator's own account first: the tab is about what *you* have
        // linked, and it was the one account with nothing on it.
        const holders = [ctx.me, ...ctx.some(ctx.users, NAMES.length - 1)];
        let linked = 0;

        for (const [index, holder] of holders.entries()) {
            const username = NAMES[index];
            // Both sides are unique, so an existing row on either is somebody
            // else's link and not this tool's to replace.
            const taken = await ctx.prisma.minecraftAccount.findFirst({
                where: { OR: [{ userId: holder.id }, { username }] },
                select: { id: true },
            });
            if (taken) continue;

            await ctx.create("minecraftAccount", () => ctx.prisma.minecraftAccount.create({
                data: {
                    userId: holder.id,
                    username,
                    uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
                    linkedAt: ctx.daysAgo(90),
                },
            }));
            linked += 1;
        }

        ctx.log(`${linked} Minecraft accounts linked`);
    },
};
