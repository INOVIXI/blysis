import { NextRequest, NextResponse } from "next/server";
import { attachContentTranslations, contentTranslationsInput, isAdmin, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { STAFF_TEXT, TRANSLATED_FIELDS, staffMemberSchema } from "../lib/validations";
import { readStaff } from "../lib/read-staff";

// The read and what counts as online live in lib/read-staff.ts, because the
// page renders the team on the server now and the two must not disagree. A
// reader names their language with `?locale=`. `scope=admin` is the editor's
// answer: every member, a switched-off one too, with every language of their
// role, refused to anybody who could not open the editor.
export async function GET(request: NextRequest) {
    const query = new URL(request.url).searchParams;
    if (query.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        const members = await prisma.staffMember.findMany({ orderBy: { order: "asc" }, take: 200 });
        return NextResponse.json({ members: await attachContentTranslations(prisma, STAFF_TEXT, members) });
    }
    const onlineOnly = query.get("online") === "1";
    return NextResponse.json({ members: await readStaff(onlineOnly, query.get("locale") ?? "") });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = staffMemberSchema.safeParse(jsonBody);
    if (!parsed.success) {
        return NextResponse.json({ error: "Name and role required" }, { status: 400 });
    }
    const translations = contentTranslationsInput(jsonBody, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const { name, role, avatar, userId, order } = parsed.data;

    const member = await prisma.$transaction(async (tx) => {
        const created = await tx.staffMember.create({
            data: { name, role, avatar: avatar || null, userId: userId || null, order: order || 0 },
        });
        if (translations.value) await saveContentTranslations(tx, { ...STAFF_TEXT, recordId: created.id }, translations.value);
        return created;
    });
    return NextResponse.json({ member }, { status: 201 });
}
