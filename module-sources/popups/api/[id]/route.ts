import { NextRequest, NextResponse } from "next/server";
import { contentTranslationsInput, deleteContentTranslations, isAdmin, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { POPUP_TEXT, TRANSLATED_FIELDS, popupUpdateSchema } from "../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = popupUpdateSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }
    const translations = contentTranslationsInput((body as { translations?: unknown }).translations, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const popup = await prisma.$transaction(async (tx) => {
        const updated = await tx.popup.update({ where: { id }, data: validation.data });
        if (translations.value) await saveContentTranslations(tx, { ...POPUP_TEXT, recordId: id }, translations.value);
        return updated;
    });
    return NextResponse.json({ popup });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    await prisma.$transaction(async (tx) => {
        await tx.popup.delete({ where: { id } });
        await deleteContentTranslations(tx, POPUP_TEXT, [id]);
    });
    return NextResponse.json({ message: "Deleted" });
}
