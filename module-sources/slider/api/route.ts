import { NextRequest, NextResponse } from "next/server";
import { attachContentTranslations, contentTranslationsInput, isAdmin, prisma, readJsonBody, saveContentTranslations, translateContent } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { SLIDE_TEXT, TRANSLATED_FIELDS, slideCreateSchema } from "../lib/validations";

// GET /api/v1/slider - Slides for the homepage widget, or every slide for
// the admin screen. An admin that only ever saw the active ones had no way
// back to a slide they had just switched off.
//
// `scope=admin` is the editor's answer, with every language of each slide,
// and is refused to anybody who is not an admin. The widget's answer is read
// in `?locale=`, and in the original where the admin wrote no translation.
export async function GET(request: NextRequest) {
    const query = new URL(request.url).searchParams;
    const session = await auth();
    const admin = session?.user?.id ? await isAdmin(session.user.id) : false;
    if (query.get("scope") === "admin") {
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        // A homepage carousel, so a ceiling nobody reaches rather than a page.
        const items = await prisma.sliderItem.findMany({ orderBy: { order: "asc" }, take: 500 });
        return NextResponse.json({ items: await attachContentTranslations(prisma, SLIDE_TEXT, items) });
    }
    const items = await prisma.sliderItem.findMany({
        where: admin ? {} : { isActive: true },
        orderBy: { order: "asc" },
    });
    const locale = query.get("locale") ?? "";
    return NextResponse.json({ items: await translateContent(prisma, SLIDE_TEXT, items, ["title", "subtitle"], locale) });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = slideCreateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const fields = parsed.data;

    const item = await prisma.$transaction(async (tx) => {
        const created = await tx.sliderItem.create({ data: {
            title: fields.title || null,
            subtitle: fields.subtitle || null,
            image: fields.image,
            link: fields.link || null,
            order: fields.order || 0,
            isActive: fields.isActive ?? true,
        } });
        if (translations.value) await saveContentTranslations(tx, { ...SLIDE_TEXT, recordId: created.id }, translations.value);
        return created;
    });
    return NextResponse.json({ item }, { status: 201 });
}
