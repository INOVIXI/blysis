import { NextRequest, NextResponse } from "next/server";
import { isAdmin, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { announcementCreateSchema } from "../lib/validations";

/**
 * This answer is the same whoever asked, so a proxy in front of the site may
 * hold it briefly. `s-maxage` speaks to shared caches and not to browsers, so
 * no visitor's own cache is involved. Anything here that ever starts varying
 * by who is asking has to lose this.
 */
const SHARED_CACHE = { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" };

// GET /api/v1/announcements - Public: active announcements
export async function GET() {
    const now = new Date();

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

    return NextResponse.json({ announcements }, { headers: SHARED_CACHE });
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
    const { title, content, type, isActive, dismissible, includePages, excludePages, startsAt, endsAt, publishAt } = parsed.data;

    const announcement = await prisma.announcement.create({
        data: {
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
        },
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
