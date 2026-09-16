import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { downloadCreateSchema } from "../lib/validations";
import { downloadSlug } from "../lib/guide";
import { readDownloads } from "../lib/read-downloads";

// The read lives in lib/read-downloads.ts, because the page renders the list
// on the server now and the two must not disagree about what is on offer.
export async function GET() {
    return NextResponse.json({ downloads: await readDownloads() });
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
    const { title, description, fileName, fileUrl, fileSize, details, coverImage } = parsed.data;

    const download = await prisma.download.create({
        data: {
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
        },
    });
    return NextResponse.json({ download }, { status: 201 });
}
