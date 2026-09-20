import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * Three signs on doors that moved.
 *
 * A redirect rule is invisible until somebody follows it, so the screen is
 * the only place it exists - and with no rows there was nothing to show that
 * a rule has three parts an operator has to get right: where from, where to,
 * and whether a search engine should forget the old address.
 *
 * Every `from` here is an address this site does not serve, so nothing that
 * works starts redirecting. One is temporary, which is the rule you write
 * while a page is being moved rather than after; one is switched off, which
 * is how an operator retires a rule without losing what it said.
 */
const RULES: [string, string, boolean, boolean, string][] = [
    ["/shop", "/store", true, true, "The store moved in the 2.0 redesign."],
    ["/news", "/blog", true, true, "Announcements became the blog."],
    ["/vip", "/store", false, false, "Kept for the campaign; switched off until it runs again."],
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        for (const [from, to, permanent, isActive, note] of RULES) {
            const existing = await ctx.prisma.urlRedirect.findUnique({ where: { from } });
            if (existing) continue;
            await ctx.create("urlRedirect", () => ctx.prisma.urlRedirect.create({
                data: { from, to, permanent, isActive, note },
            }));
        }
        ctx.log(`${RULES.length} redirect rules`);
    },
};
