import { NextRequest, NextResponse } from "next/server";
import { attachContentTranslations, contentTranslationsInput, isAdmin, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { DOWNLOAD_TEXT, TRANSLATED_FIELDS, downloadCreateSchema } from "../lib/validations";
import { downloadSlug } from "../lib/guide";
import { readDownloads } from "../lib/read-downloads";

// The read lives in lib/read-downloads.ts, because the page renders the list
// on the server now and the two must not disagree about what is on offer.
// The visitor's answer is read in `?locale=`.
//
// `scope=admin` is the editor's answer: every file, a switched-off one too,
// with every language of each, refused to anybody who is not an admin.
export async function GET(request: NextRequest) {
    const query = new URL(request.url).searchParams;
    if (query.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        const downloads = await prisma.download.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
        return NextResponse.json({ downloads: await attachContentTranslations(prisma, DOWNLOAD_TEXT, downloads) });
    }
    return NextResponse.json({ downloads: await readDownloads(query.get("locale") ?? "") });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = downloadCreateSchema.safeParse(jsonBody);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const translations = contentTranslationsInput(jsonBody, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const { title, description, fileName, fileUrl, fileSize, details, coverImage } = parsed.data;

    const download = await prisma.$transaction(async (tx) => {
        const created = await tx.download.create({ data: {
            title,
            slug: downloadSlug(title),
            description: description || null,
            // Sanitised on the way in: an admin account is a trust boundary,
            // not a guarantee, and this is rendered to every visitor.
            details: details ? details : null,
            coverImage: coverImage || null,
            fileName,
            fileUrl,
            fileSize: fileSize || null,
        } });
        if (translations.value) await saveContentTranslations(tx, { ...DOWNLOAD_TEXT, recordId: created.id }, translations.value);
        return created;
    });
    return NextResponse.json({ download }, { status: 201 });
}
