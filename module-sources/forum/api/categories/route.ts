import { NextRequest, NextResponse } from "next/server";
import { visibleCategoryIds } from "../../lib/visible-categories";
import { generateSlug } from "@/core/sdk";
import { attachContentTranslations, contentTranslationsInput, isAdmin, prisma, readJsonBody, saveContentTranslations, translateContent } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { forumCategorySchema } from "../../lib/validations";
import { denyGuestView } from "../../lib/guest-view";
import { CATEGORY_TEXT, TRANSLATED_FIELDS } from "../../lib/category-text";

// GET /api/v1/forum/categories
/**
 * GET /api/v1/forum/categories - the sections a reader may open, and the
 * panel's list.
 *
 * The panel read the reader's answer, so a section an operator switched off
 * left the one screen that could switch it back on - and the private ones are
 * filtered by what the *reader* may see, which for an operator managing the
 * board is the wrong question entirely. The panel's answer carries every
 * language of each name and description; a reader's is in `?locale=`, and
 * the original where the admin wrote no translation.
 */
export async function GET(request: NextRequest) {
    if (new URL(request.url).searchParams.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        const all = await prisma.forumCategory.findMany({
            orderBy: { order: "asc" },
            include: { _count: { select: { topics: true } } },
        });
        return NextResponse.json({ categories: await attachContentTranslations(prisma, CATEGORY_TEXT, all) });
    }

    const denied = await denyGuestView();
    if (denied) return denied;

    // A private category has more than one door, and this is the front one.
    const reader = await auth();
    const readable = await visibleCategoryIds(reader?.user?.role ?? null);
    const categories = await prisma.forumCategory.findMany({
        where: {
            isActive: true,
            ...(readable.everything ? {} : { id: { in: readable.categoryIds } }),
        },
        orderBy: { order: "asc" },
        include: {
            _count: { select: { topics: true } },
        },
    });

    const locale = new URL(request.url).searchParams.get("locale") ?? "";
    return NextResponse.json({ categories: await translateContent(prisma, CATEGORY_TEXT, categories, ["name", "description"], locale) });
}

// POST /api/v1/forum/categories
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = forumCategorySchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }

    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const { name, slug: requestedSlug, description, icon, color, order, isActive } = validation.data;
    const slug = requestedSlug || generateSlug(name);

    const existing = await prisma.forumCategory.findUnique({ where: { slug } });
    if (existing) {
        return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
    }

    const category = await prisma.$transaction(async (tx) => {
        const created = await tx.forumCategory.create({
            data: { name, slug, description, icon, color, order: order || 0, isActive: isActive ?? true },
        });
        if (translations.value) await saveContentTranslations(tx, { ...CATEGORY_TEXT, recordId: created.id }, translations.value);
        return created;
    });

    return NextResponse.json({ category }, { status: 201 });
}
