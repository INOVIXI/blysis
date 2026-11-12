import { NextRequest, NextResponse } from "next/server";
import { attachContentTranslations, contentTranslationsInput, isAdmin, logActivity, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";
import { cardImage, cardLink } from "../../lib/card";
import { readShowcaseCards } from "../../lib/read-cards";
import { CARD_TEXT, TRANSLATED_FIELDS } from "../../lib/card-text";

/**
 * The cards, as a visitor sees them and as an operator writes them.
 *
 * The addresses are cleaned on the way out rather than only on the way in: a
 * row written before a rule tightened, or by hand, still has to draw safely.
 * A card whose link is dropped is still a card.
 */
const cardSchema = z.object({
    title: z.string().min(1, "A title is required").max(120),
    body: z.string().max(500).optional(),
    image: z.string().max(1000).optional(),
    href: z.string().max(1000).optional(),
    order: z.number().int().min(0).max(9999).default(0),
});

// The read and the address cleaning live in lib/read-cards.ts, because the
// page renders the cards on the server now and a link cleaned on one path and
// not the other is the whole point of cleaning it. A reader names their
// language with `?locale=`. `scope=admin` is the editor's answer: every card,
// a switched-off one too, with every language beside the originals, refused
// to anybody who could not open the editor.
export async function GET(request: NextRequest) {
    const query = new URL(request.url).searchParams;
    if (query.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        const cards = await prisma.showcaseCard.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }], take: 100 });
        return NextResponse.json({ cards: await attachContentTranslations(prisma, CARD_TEXT, cards) });
    }
    return NextResponse.json({ cards: await readShowcaseCards(query.get("locale") ?? "") });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = cardSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    // Refused rather than quietly dropped: an operator who pasted an address
    // meant it, and a card that saves without it looks like it worked.
    if (parsed.data.href && !cardLink(parsed.data.href)) {
        return NextResponse.json(
            { error: "A link has to be a path on this site or a whole https address", code: "showcase_bad_link" },
            { status: 400 },
        );
    }
    if (parsed.data.image && !cardImage(parsed.data.image)) {
        return NextResponse.json(
            { error: "A picture has to be a path on this site or a whole https address", code: "showcase_bad_image" },
            { status: 400 },
        );
    }

    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const card = await prisma.$transaction(async (tx) => {
        const created = await tx.showcaseCard.create({
            data: {
                title: parsed.data.title,
                body: parsed.data.body ?? null,
                image: parsed.data.image ?? null,
                href: parsed.data.href ?? null,
                order: parsed.data.order,
            },
        });
        if (translations.value) await saveContentTranslations(tx, { ...CARD_TEXT, recordId: created.id }, translations.value);
        return created;
    });

    await logActivity({
        userId: session.user.id,
        action: "showcase.card.created",
        entity: "showcase_card",
        entityId: card.id,
        metadata: { title: card.title },
    }).catch(() => {});

    return NextResponse.json({ card }, { status: 201 });
}
