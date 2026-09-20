import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * A wall with a conversation on it.
 *
 * A profile with an empty wall shows none of what the wall is for: the reply
 * indent, the delete control that only appears on your own, the "and 4 more
 * replies" line, the pager. So the operator's own profile gets a handful with
 * replies under some of them, and a few other members get one each so the
 * feature is visible from more than one page.
 */
const NOTES = [
    "Welcome to the server - shout if you need anything.",
    "Thanks for the help with the build yesterday.",
    "Are you around this weekend for the event?",
    "Congratulations on the rank.",
    "Left you a reply on the forum thread.",
    "Good luck with the tournament.",
    "That spawn design is excellent.",
    "Happy anniversary on the server.",
];

const REPLIES = [
    "Thank you.",
    "Any time.",
    "Will be there.",
    "Appreciate it.",
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        const wallOwners = [ctx.me, ...ctx.some(ctx.users, 3)];
        let written = 0;
        let replied = 0;

        for (const owner of wallOwners) {
            const already = await ctx.prisma.profilePost.count({ where: { profileUserId: owner.id } });
            if (already > 0) continue;

            const howMany = owner.id === ctx.me.id ? NOTES.length : 1;
            for (let index = 0; index < howMany; index += 1) {
                // Never from the owner: a wall of notes to yourself shows
                // nothing about who writes on whose profile.
                const author = ctx.pick(ctx.users.filter((u) => u.id !== owner.id));
                const post = await ctx.create("profilePost", () => ctx.prisma.profilePost.create({
                    data: {
                        profileUserId: owner.id,
                        authorId: author.id,
                        body: NOTES[index % NOTES.length],
                        createdAt: ctx.daysAgo(60),
                    },
                }));
                written += 1;

                // Some have replies and some do not, because a wall where
                // every note is answered hides the unanswered one.
                if (index % 2 === 0) {
                    const howManyReplies = index === 0 ? 4 : 1;
                    for (let r = 0; r < howManyReplies; r += 1) {
                        await ctx.create("profilePostReply", () => ctx.prisma.profilePostReply.create({
                            data: {
                                postId: post.id,
                                authorId: r % 2 === 0 ? owner.id : author.id,
                                body: REPLIES[r % REPLIES.length],
                                createdAt: ctx.daysAgo(30),
                            },
                        }));
                        replied += 1;
                    }
                }
            }
        }

        ctx.log(`${written} profile posts, ${replied} replies across ${wallOwners.length} walls`);
    },
};
