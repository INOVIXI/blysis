import { NextRequest, NextResponse } from "next/server";
import { contentTranslationsInput, deleteContentTranslations, isAdmin, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { PRIZE_TEXT, WHEEL_TEXT, WHEEL_TRANSLATED_FIELDS, wheelSchema } from "../../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

/** 401 when nobody is signed in, 403 when they are and may not do this. */
async function refuse(): Promise<NextResponse | null> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return null;
}

// PATCH /api/v1/wheel/admin/wheels/[id]
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const refused = await refuse();
    if (refused) return refused;

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const parsed = wheelSchema.partial().safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const translations = contentTranslationsInput(body, WHEEL_TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const { roleId, ...fields } = parsed.data;
    const wheel = await prisma.$transaction(async (tx) => {
        const updated = await tx.wheel.update({
            where: { id },
            data: {
                ...fields,
                ...(roleId === undefined ? {} : { roleIds: roleId ? [roleId] : [] }),
            },
        });
        if (translations.value) await saveContentTranslations(tx, { ...WHEEL_TEXT, recordId: id }, translations.value);
        return updated;
    });
    return NextResponse.json({ wheel });
}

// DELETE /api/v1/wheel/admin/wheels/[id]
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const refused = await refuse();
    if (refused) return refused;

    const { id } = await params;
    // The prizes go with it (the row owns them); the spins stay, with their
    // wheel set to null, because a person's history is not the operator's to
    // delete along with a wheel they retired. Nothing in the database ties a
    // translation to a row, so the wheel's and its prizes' go in the same
    // transaction.
    await prisma.$transaction(async (tx) => {
        const prizes = await tx.wheelPrize.findMany({ where: { wheelId: id }, select: { id: true } });
        await tx.wheel.delete({ where: { id } });
        await deleteContentTranslations(tx, WHEEL_TEXT, [id]);
        await deleteContentTranslations(tx, PRIZE_TEXT, prizes.map((prize) => prize.id));
    });
    return NextResponse.json({ deleted: true });
}
