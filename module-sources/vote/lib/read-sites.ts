/**
 * The sites to vote on, read on the server.
 *
 * The page fetched them after it had loaded, so the HTML the server sent
 * carried no site and no reward: measured, 147 characters of text inside
 * `<main>`. Pressing one is still the browser's job - it records the vote and
 * opens the site - and that is the only part that is.
 */
import { prisma, translateContent } from "@/core/sdk/server";
import { VOTE_SITE_TEXT } from "./validations";

/** The sites with each name in `locale`, and the original where the admin wrote none. */
export async function readVoteSites(locale = "") {
    const sites = await prisma.voteSite.findMany({
        where: { isActive: true },
        orderBy: { order: "asc" },
        take: 100,
        // The row draws the running total beside each site.
        include: { _count: { select: { votes: true } } },
    });
    return translateContent(prisma, VOTE_SITE_TEXT, sites, ["name"], locale);
}
