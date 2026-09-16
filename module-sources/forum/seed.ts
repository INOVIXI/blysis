import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * A forum with conversations in it.
 *
 * The point of the data is the shape of the list: some topics pinned, one or
 * two locked, most with replies and a few with none, and the replies spread
 * over days so "last activity" orders differently from "created". A board
 * where every topic has the same three replies from the same person tests
 * nothing.
 */
const CATEGORIES = [
    ["General", "Anything about the server.", "MessageSquare", "#3b82f6"],
    ["Support", "Something is broken and you want help.", "LifeBuoy", "#f97316"],
    ["Suggestions", "Ideas for what we build next.", "Lightbulb", "#22c55e"],
    ["Off topic", "Everything else.", "Coffee", "#a855f7"],
];

const TOPICS = [
    "Can we get bigger plots on creative?",
    "Lag on the nether portal at spawn",
    "Best way to make money in the first week?",
    "Post your base screenshots here",
    "Bug: shop signs stop working after restart",
    "Suggestion: an /afk command",
    "Who wants to team up for the event?",
    "What happened to the old spawn?",
    "Trading enchanted gear - post what you have",
    "Rules question: is autoclicking allowed?",
    "The economy feels broken after the reset",
    "Server restarted twice today, is something wrong?",
    "New player here, where do I start?",
    "Feature request: search inside the forum",
    "Anyone else missing items after the update?",
    "Show us your best build of the month",
    "How do I report someone for griefing?",
    "The wiki is out of date in three places",
    "Voting rewards did not arrive, anyone else?",
    "Can we have a second creative world?",
    "Weekly event thread: what would you run?",
    "Is there a way to sort the shop by price?",
    "Lost my inventory after a disconnect",
    "Name suggestions for the new region",
    "Ping went up last night for everyone I know",
    "What is the policy on alt accounts?",
    "Idea: a channel for build contests",
    "My rank did not apply after checkout",
    "Where do I find the old changelog?",
    "Thanks to whoever fixed the spawn lag",
];

const REPLIES = [
    "Same here, thought it was just me.",
    "Works fine on my side. Which world were you in?",
    "This has come up before. There is a fix in the next update.",
    "Try relogging first, that clears it half the time.",
    "Screenshot or it did not happen.",
    "Agreed, this would save a lot of time.",
    "I opened a ticket about this last week.",
    "Not a bug, that is how the plugin works.",
    "Thanks, that fixed it.",
    "Moving this to the right category.",
    "Locking this, it is answered above.",
    "I can reproduce it, will pass it on.",
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        const categories: { id: string }[] = [];
        for (const [index, [name, description, icon, color]] of CATEGORIES.entries()) {
            const slug = name.toLowerCase().replace(/\s+/g, "-");
            categories.push(await ctx.create("forumCategory", () => ctx.prisma.forumCategory.upsert({
                where: { slug },
                update: {},
                create: { name, slug, description, icon, color, order: index },
            })));
        }

        const staff = ctx.users.filter((u) => u.rolePriority > 0);
        // Past one page of the forum's own default, so the pager is a thing a
        // reader can see rather than a branch nobody reaches.
        const howMany = Math.min(TOPICS.length * 4, 9 * ctx.scale);
        let posts = 0;

        for (let i = 0; i < howMany; i++) {
            const base = TOPICS[i % TOPICS.length];
            const title = i < TOPICS.length ? base : `${base} (${Math.floor(i / TOPICS.length) + 1})`;
            const createdAt = ctx.daysAgo(120);
            const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${i + 1}`;
            // A rerun finds its own topics rather than colliding with them:
            // the slug is unique, so writing the same one twice is an error
            // that takes the rest of the seed down with it.
            const already = await ctx.prisma.forumTopic.findUnique({ where: { slug }, select: { id: true } });
            if (already) continue;
            const topic = await ctx.create("forumTopic", () => ctx.prisma.forumTopic.create({
                data: {
                    title,
                    slug,
                    content: ctx.paragraphs(ctx.int(1, 3)),
                    categoryId: ctx.pick(categories).id,
                    authorId: ctx.pick(ctx.users).id,
                    isPinned: i < 2,
                    isLocked: ctx.chance(8),
                    views: ctx.int(5, 900),
                    moderationState: ctx.chance(93) ? "APPROVED" : "PENDING",
                    createdAt,
                },
            }));

            // A thread's replies arrive over days, so "last activity" and
            // "created" order the board differently - which is the ordering
            // bug nobody sees on a board seeded all at once.
            let when = createdAt.getTime();
            for (let r = 0; r < ctx.int(0, 7); r++) {
                when += ctx.int(1, 40) * 3_600_000;
                if (when > Date.now()) break;
                const author = ctx.chance(25) && staff.length ? ctx.pick(staff) : ctx.pick(ctx.users);
                await ctx.create("forumPost", () => ctx.prisma.forumPost.create({
                    data: {
                        content: ctx.pick(REPLIES),
                        topicId: topic.id,
                        authorId: author.id,
                        createdAt: new Date(when),
                    },
                }));
                posts += 1;
            }

            for (const user of ctx.some(ctx.users, ctx.int(0, 6))) {
                await ctx.create("forumTopicLike", () => ctx.prisma.forumTopicLike.create({
                    data: { topicId: topic.id, userId: user.id },
                }));
            }
        }

        ctx.log(`${howMany} topics, ${posts} replies, ${categories.length} categories`);
    },
};
