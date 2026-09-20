import { NextRequest, NextResponse } from "next/server";
import { generateSlug } from "@/core/sdk";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { customPageCreateSchema } from "../lib/validations";

// GET /api/v1/custom-pages
/**
 * GET /api/v1/custom-pages - the published pages, and the panel's list.
 *
 * The panel read the published answer while the module shipped "Draft" and
 * "Published" labels, so a draft was invisible on the only screen that could
 * publish it and the Draft label could never be drawn at all.
 */
export async function GET(request: NextRequest) {
    if (new URL(request.url).searchParams.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        const all = await prisma.customPage.findMany({
            orderBy: { order: "asc" },
            select: { id: true, title: true, slug: true, isActive: true, order: true, createdAt: true },
            take: 500,
        });
        return NextResponse.json({ pages: all });
    }

    const pages = await prisma.customPage.findMany({
        where: { isActive: true },
        orderBy: { order: "asc" },
        select: { id: true, title: true, slug: true, isActive: true, order: true, createdAt: true },
    });
    return NextResponse.json({ pages });
}

// POST /api/v1/custom-pages - Admin
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = customPageCreateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const { title, content, isActive, order } = parsed.data;

    let slug = parsed.data.slug || generateSlug(title);
    const existing = await prisma.customPage.findUnique({ where: { slug } });
    if (existing) slug = `${slug}-${Date.now().toString(36)}`;

    const page = await prisma.customPage.create({
        data: { title, slug, content: content, isActive: isActive ?? true, order: order || 0 },
    });

    return NextResponse.json({ page }, { status: 201 });
}
