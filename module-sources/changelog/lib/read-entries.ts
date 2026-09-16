/**
 * The published entries, read on the server.
 *
 * The timeline fetched them after the page had loaded, so the HTML the server
 * sent carried no entry and no link to one: measured, the page answered with
 * 61 characters of text inside `<main>` and no link to an entry's own page.
 *
 * The endpoint still exists and calls this, so what counts as published - the
 * switch, and the hour it goes out - is decided once. The long form is left
 * out on purpose: it is a page's worth of markup per entry and the timeline
 * renders none of it. What the list needs is whether there is a page to link
 * to.
 */
import { prisma } from "@/core/sdk/server";

export async function readChangelogEntries() {
    const now = new Date();
    const rows = await prisma.changelogEntry.findMany({
        where: {
            isActive: true,
            OR: [{ publishAt: null }, { publishAt: { lte: now } }],
        },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
            id: true, number: true, slug: true, version: true, title: true,
            content: true, type: true, color: true, createdAt: true,
            coverImage: true, details: true,
        },
    });
    return rows.map(({ details, ...entry }) => ({
        ...entry,
        hasDetails: typeof details === "string" && details.trim() !== "",
    }));
}
