import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * A knowledge base with articles under every category.
 *
 * The index groups by category and the sidebar lists the most read, so the
 * view counts are spread rather than uniform - otherwise "popular" is just
 * whatever the database happened to return first.
 */
const CATEGORIES: [string, string, string, string[]][] = [
    ["Getting started", "First steps for a new player.", "Rocket", [
        "How to join the server",
        "Which version do I need?",
        "I cannot connect - what to check first",
        "How to link your account",
    ]],
    ["Purchases", "Ranks, keys and everything in the store.", "ShoppingBag", [
        "My rank did not arrive",
        "Which payment methods work",
        "Refunds: what we can and cannot do",
        "Buying for another player",
    ]],
    ["Rules and appeals", "What is allowed, and what to do when you are banned.", "Shield", [
        "The full rule list",
        "How to appeal a ban",
        "How to report a player",
    ]],
    ["Account", "Passwords, emails and two-factor.", "User", [
        "Changing your password",
        "Turning on two-factor authentication",
        "Deleting your account",
    ]],
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        let articles = 0;
        for (const [index, [name, description, icon, titles]] of CATEGORIES.entries()) {
            const slug = name.toLowerCase().replace(/\s+/g, "-");
            const category = await ctx.create("helpCategory", () => ctx.prisma.helpCategory.upsert({
                where: { slug },
                update: {},
                create: { name, slug, description, icon, order: index },
            }));

            for (const title of titles) {
                const articleSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                await ctx.create("helpArticle", () => ctx.prisma.helpArticle.upsert({
                    where: { slug: articleSlug },
                    update: {},
                    create: {
                        title,
                        slug: articleSlug,
                        content: ctx.paragraphs(ctx.int(2, 5)),
                        views: ctx.int(10, 2500),
                        helpful: ctx.int(0, 60),
                        notHelpful: ctx.int(0, 8),
                        categoryId: category.id,
                        createdAt: ctx.daysAgo(300),
                    },
                }));
                articles += 1;
            }
        }
        ctx.log(`${articles} articles in ${CATEGORIES.length} categories`);
    },
};
