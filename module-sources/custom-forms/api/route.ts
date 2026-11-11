import { NextRequest, NextResponse } from "next/server";
import { generateSlug } from "@/core/sdk";
import { contentTranslationsInput, isAdmin, prisma, readJsonBody, saveContentTranslations, translateContent } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { formCreateSchema } from "../lib/validations";
import { FORM_TEXT, formTextLimits } from "../lib/form-text";

/**
 * GET /api/v1/forms - the forms still taking answers, and the panel's list.
 *
 * The panel read the reader's answer, so a form an operator closed left the
 * one screen that could open it again.
 *
 * The reader's list is read in `?locale=`, and in the original where the
 * admin wrote no translation; the panel's list is the columns as typed.
 */
export async function GET(request: NextRequest) {
    const query = new URL(request.url).searchParams;
    if (query.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        const all = await prisma.customForm.findMany({
            select: { id: true, title: true, slug: true, description: true, isActive: true },
            orderBy: { createdAt: "desc" },
            take: 500,
        });
        return NextResponse.json({ forms: all });
    }

    const forms = await prisma.customForm.findMany({
        where: { isActive: true },
        select: { id: true, title: true, slug: true, description: true },
        orderBy: { createdAt: "desc" },
    });
    const locale = query.get("locale") ?? "";
    return NextResponse.json({ forms: await translateContent(prisma, FORM_TEXT, forms, ["title", "description"], locale) });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = formCreateSchema.safeParse(jsonBody);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const { title, description, fields } = parsed.data;
    // Each question's words may be translated too, so what may be sent is
    // read off the questions being saved.
    const translations = contentTranslationsInput(jsonBody, formTextLimits(fields));
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const slug = generateSlug(title);
    const form = await prisma.$transaction(async (tx) => {
        const created = await tx.customForm.create({
            data: { title, slug, description: description || null, fields },
        });
        if (translations.value) await saveContentTranslations(tx, { ...FORM_TEXT, recordId: created.id }, translations.value);
        return created;
    });

    // Fire hook for cross-module reactions
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("customforms.form.created", form);

    return NextResponse.json({ form }, { status: 201 });
}
