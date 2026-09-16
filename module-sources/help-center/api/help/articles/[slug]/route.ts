import { NextRequest, NextResponse } from "next/server";
import { isAdmin, moduleSettings, prisma, rateLimitForRole, readJsonBody, getClientIP } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { helpArticleUpdateSchema, helpFeedbackSchema } from "../../../../lib/validations";
import { countArticleView, readArticle } from "../../../../lib/read-article";

interface RouteParams {
    params: Promise<{ slug: string }>;
}

// GET /api/v1/help/articles/[slug] - Get article by slug
//
// The read and the rule about what may be shown live in lib/read-article.ts,
// because the page renders the article on the server now and the two must not
// disagree.
export async function GET(_request: NextRequest, { params }: RouteParams) {
    const { slug } = await params;

    const read = await readArticle(slug);
    if (!read) {
        return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }
    await countArticleView(read.article.id);

    return NextResponse.json({ ...read.article, settings: read.settings });
}

// POST /api/v1/help/articles/[slug]/feedback - Submit feedback
export async function POST(request: NextRequest, { params }: RouteParams) {
    const { slug } = await params;
    const ip = getClientIP(request.headers);
    const rl = await rateLimitForRole(
        `help-feedback:${ip}`,
        { maxRequests: 10, windowMs: 3_600_000 },
        undefined
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const { enableFeedback } = await moduleSettings<{ enableFeedback: boolean }>("help-center");
    if (!enableFeedback) {
        return NextResponse.json({ error: "Feedback is closed" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsedFeedback = helpFeedbackSchema.safeParse(body);
    if (!parsedFeedback.success) {
        return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });
    }
    const { helpful } = parsedFeedback.data;

    const article = await prisma.helpArticle.findUnique({
        where: { slug },
    });

    if (!article) {
        return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    const updateData = helpful
        ? { helpful: { increment: 1 } }
        : { notHelpful: { increment: 1 } };

    await prisma.helpArticle.update({
        where: { id: article.id },
        data: updateData,
    });

    return NextResponse.json({ success: true });
}

// PATCH /api/v1/help/articles/[slug] - Update article (admin)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { slug } = await params;
    const existing = await prisma.helpArticle.findUnique({ where: { slug } });
    if (!existing) return NextResponse.json({ error: "Article not found" }, { status: 404 });

    const body = await readJsonBody(request, { fallback: {} });
    if (body instanceof NextResponse) return body;
    const parsed = helpArticleUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.title !== undefined) data.title = fields.title;
    if (fields.slug !== undefined) data.slug = fields.slug;
    if (fields.content !== undefined) data.content = fields.content;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;
    if (fields.categoryId !== undefined) data.categoryId = fields.categoryId;

    const updated = await prisma.helpArticle.update({ where: { id: existing.id }, data });
    return NextResponse.json({ article: updated });
}

// DELETE /api/v1/help/articles/[slug] - Delete article (admin)
export async function DELETE(_: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { slug } = await params;
    const existing = await prisma.helpArticle.findUnique({ where: { slug } });
    if (!existing) return NextResponse.json({ error: "Article not found" }, { status: 404 });

    await prisma.helpArticle.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
}
