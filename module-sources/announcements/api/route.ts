import { NextRequest, NextResponse } from "next/server";
import { contentTranslationsInput, isAdmin, logActivity, prisma, readJsonBody, saveContentTranslations, translateContent } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { ANNOUNCEMENT_TEXT, TRANSLATED_FIELDS, announcementCreateSchema } from "../lib/validations";

/**
 * This answer is the same for whoever asks the same address, so a proxy in
 * front of the site may hold it briefly. The reader's language is in the
 * address (`?locale=`), so a shared cache keeps one answer per language. `s-maxage` speaks to shared caches and not to browsers, so
 * no visitor's own cache is involved. Anything here that ever starts varying
 * by who is asking has to lose this.
 */
const SHARED_CACHE = { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" };

/**
 * GET /api/v1/announcements - the live banners, inside their window.
 *
 * The panel used to read this, so a notice an operator switched off left the
 * one screen that could switch it back on, and one written for next week was
 * invisible until it published itself. The operator's answer is a route of
 * its own rather than a `scope=admin` branch here, which is what the five
 * other endpoints in this class use: this one carries a shared-cache header,
 * and an answer that varies by who asked has no business behind one. The
 * header's own comment above says so.
 */
export async function GET(request: NextRequest) {
    const now = new Date();
    // The banner names the page's language. Without one, the columns as the
    // admin typed them, which is what this answered before translations.
    const locale = new URL(request.url).searchParams.get("locale") ?? "";

    const announcements = await prisma.announcement.findMany({
        where: {
            isActive: true,
            OR: [
                { startsAt: null },
                { startsAt: { lte: now } },
            ],
            AND: [
                { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
                { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
            ],
        },
        orderBy: { createdAt: "desc" },
        // A banner shows a handful. The cap is a ceiling on what an install
        // that never expires an announcement can make this endpoint return,
        // not a page size anything here scrolls through.
        take: 100,
    });

    return NextResponse.json(
        { announcements: await translateContent(prisma, ANNOUNCEMENT_TEXT, announcements, ["title", "content"], locale) },
        { headers: SHARED_CACHE },
    );
}

// POST /api/v1/announcements - Admin
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = announcementCreateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const translations = contentTranslationsInput((body as { translations?: unknown }).translations, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const { title, content, type, isActive, dismissible, includePages, excludePages, startsAt, endsAt, publishAt } = parsed.data;

    const announcement = await prisma.$transaction(async (tx) => {
        const created = await tx.announcement.create({ data: {
            title,
            content: content,
            type: type || "info",
            isActive: isActive ?? true,
            dismissible: dismissible ?? true,
            includePages: includePages || null,
            excludePages: excludePages || null,
            startsAt: startsAt ? new Date(startsAt) : null,
            endsAt: endsAt ? new Date(endsAt) : null,
            publishAt: publishAt ? new Date(publishAt) : null,
        } });
        if (translations.value) {
            await saveContentTranslations(tx, { ...ANNOUNCEMENT_TEXT, recordId: created.id }, translations.value);
        }
        return created;
    });

    await logActivity({
        userId: session.user.id,
        action: "announcement_created",
        metadata: { description: `Created: ${announcement.title}` },
    });

    // Fire hook for cross-module reactions
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("announcements.announcement.created", announcement);

    // Public activity feed entry
    await prisma.activityFeedItem.create({
        data: {
            type: "announcements.announcement.created",
            actorId: session.user.id,
            title: `Announcement: ${announcement.title}`,
            href: `/`,
            icon: "Megaphone",
            isPublic: true,
        },
    }).catch(() => {});

    return NextResponse.json({ announcement }, { status: 201 });
}
