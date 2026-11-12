import { NextRequest, NextResponse } from "next/server";
import { attachContentTranslations, contentTranslationsInput, isAdmin, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { readVoteSites } from "../../lib/read-sites";
import { auth } from "@/core/sdk/auth";
import { TRANSLATED_FIELDS, VOTE_SITE_TEXT, voteSiteCreateSchema } from "../../lib/validations";

// GET /api/v1/vote - List vote sites
// The read lives in lib/read-sites.ts, because the page renders the list on
// the server now and the two must not drift. A reader names their language
// with `?locale=`. `scope=admin` is the editor's answer: every site, a
// switched-off one too, with every language of its name, refused to anybody
// who could not open the editor.
export async function GET(request: NextRequest) {
    const query = new URL(request.url).searchParams;
    if (query.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        const sites = await prisma.voteSite.findMany({ orderBy: { order: "asc" }, take: 100 });
        return NextResponse.json({ sites: await attachContentTranslations(prisma, VOTE_SITE_TEXT, sites) });
    }
    return NextResponse.json({ sites: await readVoteSites(query.get("locale") ?? "") });
}

// POST /api/v1/vote - Create vote site (admin)
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = voteSiteCreateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Name and URL required" }, { status: 400 });
    }
    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const { name, url, icon } = parsed.data;

    const site = await prisma.$transaction(async (tx) => {
        const created = await tx.voteSite.create({
            data: { name, url, icon: icon || null },
        });
        if (translations.value) await saveContentTranslations(tx, { ...VOTE_SITE_TEXT, recordId: created.id }, translations.value);
        return created;
    });

    return NextResponse.json({ site }, { status: 201 });
}
