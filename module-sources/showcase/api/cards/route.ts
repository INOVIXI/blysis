import { NextRequest, NextResponse } from "next/server";
import { isAdmin, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";
import { cardImage, cardLink } from "../../lib/card";
import { readShowcaseCards } from "../../lib/read-cards";

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
// not the other is the whole point of cleaning it.
export async function GET() {
    return NextResponse.json({ cards: await readShowcaseCards() });
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

    const card = await prisma.showcaseCard.create({
        data: {
            title: parsed.data.title,
            body: parsed.data.body ?? null,
            image: parsed.data.image ?? null,
            href: parsed.data.href ?? null,
            order: parsed.data.order,
        },
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
