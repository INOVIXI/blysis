/**
 * The cards, read on the server.
 *
 * The page fetched them after it had loaded, so the HTML the server sent
 * carried no card and no heading: measured, 58 characters of text inside
 * `<main>`.
 *
 * The addresses are cleaned here rather than only where they are written: a
 * row written before a rule tightened, or by hand, still has to draw safely.
 * A card whose link is dropped is still a card. The endpoint calls this too,
 * so the cleaning cannot happen on one path and not the other.
 */
import { prisma } from "@/core/sdk/server";
import { cardImage, cardLink } from "./card";

export async function readShowcaseCards() {
    const cards = await prisma.showcaseCard.findMany({
        where: { isActive: true },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        take: 100,
    });
    return cards.map((card) => ({
        id: card.id,
        title: card.title,
        body: card.body,
        image: cardImage(card.image),
        href: cardLink(card.href),
    }));
}
