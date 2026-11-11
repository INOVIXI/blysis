import { NextRequest, NextResponse } from "next/server";
import { attachContentTranslations, contentTranslationsInput, isAdmin, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { WHEEL_TEXT, WHEEL_TRANSLATED_FIELDS, wheelSchema } from "../../../lib/validations";

/**
 * Every wheel, including the ones that are switched off.
 *
 * The public listing at /api/v1/wheel/wheels answers the same question to
 * everybody: the wheels a visitor may see, with their prizes and whether they
 * may turn one. The screen an operator manages wheels from needs the rows
 * themselves - the retired ones, the odds behind them, the role that gates
 * them - and that is a different question with a different answer, so it is a
 * different address rather than a branch inside one.
 */

/** This answer depends on who asked, so nothing may keep a copy of it. */
const PRIVATE = { "Cache-Control": "private, no-store" };

/** 401 when nobody is signed in, 403 when they are and may not do this. */
async function refuse(): Promise<NextResponse | null> {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
    }
    if (!(await isAdmin(session.user.id))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE });
    }
    return null;
}

export async function GET() {
    const refused = await refuse();
    if (refused) return refused;

    const wheels = await prisma.wheel.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
    return NextResponse.json({
        // `roleId` is what the form writes: one role is the question an
        // operator asks, and the column stays a list so several stay
        // possible through the API.
        // With every language of each, for the editor's language boxes.
        wheels: (await attachContentTranslations(prisma, WHEEL_TEXT, wheels)).map((wheel) => ({ ...wheel, roleId: wheel.roleIds[0] ?? "" })),
    }, { headers: PRIVATE });
}

export async function POST(request: NextRequest) {
    const refused = await refuse();
    if (refused) return refused;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const parsed = wheelSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const translations = contentTranslationsInput(body, WHEEL_TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const existing = await prisma.wheel.findUnique({ where: { slug: parsed.data.slug } });
    if (existing) return NextResponse.json({ error: "That address is taken" }, { status: 409 });

    const { roleId, ...fields } = parsed.data;
    const wheel = await prisma.$transaction(async (tx) => {
        const created = await tx.wheel.create({
            data: { ...fields, roleIds: roleId ? [roleId] : (fields.roleIds ?? []) },
        });
        if (translations.value) await saveContentTranslations(tx, { ...WHEEL_TEXT, recordId: created.id }, translations.value);
        return created;
    });
    return NextResponse.json({ wheel }, { status: 201, headers: PRIVATE });
}
