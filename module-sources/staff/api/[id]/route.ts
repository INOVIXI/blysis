import { NextRequest, NextResponse } from "next/server";
import { contentTranslationsInput, deleteContentTranslations, isAdmin, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";
import { STAFF_TEXT, TRANSLATED_FIELDS } from "../../lib/validations";

const staffUpdateSchema = z.object({
    name: z.string().optional(),
    role: z.string().optional(),
    avatar: z.string().nullable().optional(),
    order: z.number().int().optional(),
    isActive: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = staffUpdateSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }
    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const member = await prisma.$transaction(async (tx) => {
        const updated = await tx.staffMember.update({ where: { id }, data: validation.data });
        if (translations.value) await saveContentTranslations(tx, { ...STAFF_TEXT, recordId: id }, translations.value);
        return updated;
    });
    return NextResponse.json({ member });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    await prisma.$transaction(async (tx) => {
        await tx.staffMember.delete({ where: { id } });
        await deleteContentTranslations(tx, STAFF_TEXT, [id]);
    });
    return NextResponse.json({ message: "Deleted" });
}
