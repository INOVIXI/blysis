/**
 * GET /api/v1/ai-moderation/admin/reviews/[id]?locale= - one decision, the
 * post it was about and the reason it gave, in the reader's language.
 *
 * The post is read through core at the moment of asking: this module keeps
 * no copy. A post since deleted, or one whose module is switched off, comes
 * back as null and the decision still shows.
 */
import { NextRequest, NextResponse } from "next/server";
import { moderationReasons, prisma, readModerated } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { requireManager } from "../../../../lib/admin";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;

    const { id } = await params;
    const review = await prisma.aiModerationReview.findUnique({ where: { id } });
    if (!review) return NextResponse.json({ error: "Not found", code: "not_found" }, { status: 404 });

    const locale = request.nextUrl.searchParams.get("locale") ?? "";
    const [texts, reasons] = await Promise.all([
        readModerated(review.provider, [review.itemId]),
        review.reasonId ? moderationReasons(locale) : Promise.resolve([]),
    ]);
    const text = texts[0];

    return NextResponse.json({
        review,
        item: text ? { title: text.title, body: text.body, state: text.state, href: text.href } : null,
        reason: reasons.find((r) => r.id === review.reasonId)?.label ?? null,
    });
}
