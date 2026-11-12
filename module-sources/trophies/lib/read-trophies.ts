/**
 * The trophies on offer, read on the server.
 *
 * The page fetched them after it had loaded, so the HTML the server sent
 * carried no trophy and no description: measured, 75 characters of text inside
 * `<main>`.
 *
 * Which of them a reader has earned is a separate question and stays where it
 * was, in the browser: it is per person, so an answer the server wrote into
 * the page would be one visitor's badges cached for the next.
 */
import { prisma, translateContent } from "@/core/sdk/server";
import { TROPHY_TEXT } from "./validations";

/** The trophies, each name and description in `locale` and the original where the admin wrote none. */
export async function readTrophies(locale = "") {
    const trophies = await prisma.trophy.findMany({
        orderBy: { points: "desc" },
        include: { _count: { select: { users: true } } },
        take: 200,
    });
    return translateContent(prisma, TROPHY_TEXT, trophies, ["name", "description"], locale);
}
