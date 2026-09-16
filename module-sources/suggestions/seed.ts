import type { ModuleSeed } from "@/core/sdk/seed";
import { SUGGESTION_STATUSES } from "./lib/statuses";

/**
 * A suggestion board with votes on it.
 *
 * Vote counts have to differ, or "most voted" and "newest" sort into the same
 * order and neither is tested. Every status is represented so the filter
 * strip has something behind each chip.
 */
const IDEAS = [
    "Add an /afk command",
    "Bring back the old spawn",
    "Let us rename pets",
    "A second auction house on the survival world",
    "Discord roles that follow the in-game rank",
    "Show playtime on the profile page",
    "More storage in the vault",
    "Weekly build contests",
    "A public test server before big updates",
    "Let us hide our stats from the leaderboard",
    "Cheaper keys when you buy ten",
    "An in-game mail system",
];

const REPLIES = [
    "This would save me twenty minutes a day.",
    "Would it work on the survival world too, or only creative?",
    "We looked at this last year and the plugin could not do it. Worth another try.",
    "Please. I have asked for this three times.",
    "It is already possible with /warp, just not obvious.",
    "Not sure about this one - it would make the economy easier to abuse.",
    "Happy to test it if you need somebody.",
    "Planned for the next season, as it happens.",
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        const howMany = Math.min(IDEAS.length * 2, 4 * ctx.scale);
        let votes = 0;
        let comments = 0;

        for (let i = 0; i < howMany; i++) {
            const base = IDEAS[i % IDEAS.length];
            const suggestion = await ctx.create("suggestion", () => ctx.prisma.suggestion.create({
                data: {
                    title: i < IDEAS.length ? base : `${base} (${Math.floor(i / IDEAS.length) + 1})`,
                    content: ctx.paragraphs(ctx.int(1, 2)),
                    // Most boards are mostly open; the rest give every filter
                    // chip something to show.
                    // The module's own vocabulary, so the board's filter
                    // chips each have something behind them and no row lands
                    // in a state nothing renders.
                    status: ctx.chance(55) ? "open" : ctx.pick(SUGGESTION_STATUSES),
                    authorId: ctx.pick(ctx.users).id,
                    createdAt: ctx.daysAgo(180),
                },
            }));

            const voters = ctx.some(ctx.users, ctx.int(0, ctx.users.length - 1));
            for (const voter of voters) {
                await ctx.create("suggestionVote", () => ctx.prisma.suggestionVote.create({
                    data: { suggestionId: suggestion.id, userId: voter.id },
                }));
            }
            // The board reads `upvotes`; the votes table is what stops one
            // person voting twice. Both have to agree.
            await ctx.prisma.suggestion.update({
                where: { id: suggestion.id },
                data: { upvotes: voters.length },
            });
            votes += voters.length;

            // A board that only counts votes says how many, never why. The
            // discussion is the "why", so the seed writes one.
            for (const commenter of ctx.some(ctx.users, ctx.int(0, 5))) {
                await ctx.create("suggestionComment", () => ctx.prisma.suggestionComment.create({
                    data: {
                        content: ctx.pick(REPLIES),
                        suggestionId: suggestion.id,
                        authorId: commenter.id,
                        moderationState: ctx.chance(92) ? "APPROVED" : "PENDING",
                        createdAt: new Date(suggestion.createdAt.getTime() + ctx.int(1, 200) * 3_600_000),
                    },
                }));
                comments += 1;
            }
        }

        ctx.log(`${howMany} suggestions, ${votes} votes, ${comments} comments`);
    },
};
