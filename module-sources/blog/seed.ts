import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * A blog with enough in it to see the blog.
 *
 * Articles spread across categories and tags, most published and a few in
 * every other state, with comments under the busiest ones - which is what
 * makes the index's paging, the category filter, the sidebar's "recent" list
 * and the moderation queue all have something to do.
 */
const CATEGORIES = [
    ["Announcements", "What is happening and when."],
    ["Guides", "How to get more out of the server."],
    ["Updates", "What changed in the last release."],
    ["Community", "What players are building."],
];

const TAGS = ["update", "guide", "event", "season", "economy", "pvp", "build", "staff"];

/**
 * Covers, so the card design is visible on a demo site.
 *
 * The card reserves the same space whether or not an article has one, so a
 * seeded site without covers looks correct and shows nothing of what the
 * layout does with a picture. These ship with the product as small SVGs
 * rather than coming from a photo host: no network, no CSP origin to allow,
 * and a clean install can show its own blog offline.
 *
 * Not every article gets one. A real blog has a few text-only posts, and the
 * grid has to hold its rows level when it does.
 */
const COVERS = [
    "/demo/cover-update.svg",
    "/demo/cover-event.svg",
    "/demo/cover-guide.svg",
    "/demo/cover-notice.svg",
    "/demo/cover-release.svg",
    "/demo/cover-report.svg",
];

/**
 * Headlines a reader could believe. Filler words make a page that technically
 * has articles on it and still cannot be read, so the one part a visitor
 * actually reads is written rather than generated.
 */
const HEADLINES = [
    "Season 4 starts this Friday",
    "What changed in the 1.21 update",
    "How to claim your rank after buying it",
    "The new spawn is live",
    "Server maintenance on Sunday morning",
    "Meet the three new moderators",
    "Build contest: the winners",
    "Why we reset the economy, and what carries over",
    "A guide to the auction house",
    "Anti-cheat update: what it catches now",
    "Double XP weekend",
    "The rules have changed - read this before you play",
    "Backups, and what happens when a world breaks",
    "Community night: bring a friend",
    "Halloween event: every drop explained",
    "How ranks work now",
    "Report a player without leaving the game",
    "One year of this server",
    "The store is open again",
    "What we are building next",
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        const categories: { id: string }[] = [];
        for (const [name, description] of CATEGORIES) {
            const slug = name.toLowerCase();
            categories.push(await ctx.create("blogCategory", () => ctx.prisma.blogCategory.upsert({
                where: { slug },
                update: {},
                create: { name, slug, description },
            })));
        }

        const tags: { id: string }[] = [];
        for (const name of TAGS) {
            tags.push(await ctx.create("blogTag", () => ctx.prisma.blogTag.upsert({
                where: { slug: name },
                update: {},
                create: { name, slug: name },
            })));
        }

        const authors = ctx.users.filter((u) => u.rolePriority > 0);
        const howMany = 6 * ctx.scale;
        let comments = 0;

        for (let i = 0; i < howMany; i++) {
            const headline = HEADLINES[i % HEADLINES.length];
            const title = i < HEADLINES.length ? headline : `${headline} (${Math.floor(i / HEADLINES.length) + 1})`;
            const createdAt = ctx.daysAgo(400);
            // Most of an archive is published; the rest is what the admin
            // screens exist for.
            const status = ctx.chance(80) ? "PUBLISHED" : ctx.pick(["DRAFT", "SCHEDULED", "ARCHIVED"]);
            const article = await ctx.create("blogArticle", () => ctx.prisma.blogArticle.create({
                data: {
                    title,
                    slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${i + 1}`,
                    excerpt: ctx.sentence(),
                    coverImage: ctx.chance(75) ? ctx.pick(COVERS) : null,
                    content: ctx.paragraphs(ctx.int(3, 8)),
                    status: status as "PUBLISHED",
                    publishedAt: status === "PUBLISHED" ? createdAt : null,
                    publishAt: status === "SCHEDULED" ? new Date(Date.now() + ctx.int(1, 14) * 86_400_000) : null,
                    views: ctx.int(0, 4000),
                    createdAt,
                    categoryId: ctx.pick(categories).id,
                    authorId: authors.length ? ctx.pick(authors).id : ctx.pick(ctx.users).id,
                    tags: { connect: ctx.some(tags, ctx.int(1, 3)).map((t) => ({ id: t.id })) },
                },
            }));

            if (status !== "PUBLISHED") continue;
            for (let c = 0; c < ctx.int(0, 4); c++) {
                await ctx.create("blogComment", () => ctx.prisma.blogComment.create({
                    data: {
                        content: ctx.sentence(),
                        articleId: article.id,
                        authorId: ctx.pick(ctx.users).id,
                        // A moderation queue with nothing in it is a screen
                        // nobody can check.
                        moderationState: ctx.chance(85) ? "APPROVED" : "PENDING",
                        isApproved: ctx.chance(85),
                        createdAt: new Date(article.createdAt.getTime() + ctx.int(1, 72) * 3_600_000),
                    },
                }));
                comments += 1;
            }
        }

        ctx.log(`${howMany} articles, ${categories.length} categories, ${tags.length} tags, ${comments} comments`);
    },
};
