import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { contentTranslationsInput, isAdmin, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { readTrophies } from "../lib/read-trophies";
import { auth } from "@/core/sdk/auth";
import { TRANSLATED_FIELDS, TROPHY_TEXT } from "../lib/validations";

/** GET - list all trophies (public endpoint, used by profile pages too) */
// The read lives in lib/read-trophies.ts, because the page renders the list
// on the server now and the two must not drift. A reader names their
// language with `?locale=`.
export async function GET(request: NextRequest) {
    return NextResponse.json({ trophies: await readTrophies(new URL(request.url).searchParams.get("locale") ?? "") });
}

const trophySchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    icon: z.string().max(50).optional(),
    color: z.string().max(50).optional(),
    points: z.number().int().min(0).default(0),
    awardOn: z.string().max(100).optional(),
});

/** POST - create trophy (admin) */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = trophySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid" }, { status: 400 });
    }

    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const trophy = await prisma.$transaction(async (tx) => {
        const created = await tx.trophy.create({ data: parsed.data });
        if (translations.value) await saveContentTranslations(tx, { ...TROPHY_TEXT, recordId: created.id }, translations.value);
        return created;
    });
    return NextResponse.json({ trophy }, { status: 201 });
}
