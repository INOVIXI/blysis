import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";
import { entrySlug } from "../lib/entry-page";
import { readChangelogEntries } from "../lib/read-entries";

// The read and what counts as published live in lib/read-entries.ts, because
// the page renders the timeline on the server now and the two must not
// disagree about which entries are out.
export async function GET() {
    return NextResponse.json({ entries: await readChangelogEntries() });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const schema = z.object({
        version: z.string().min(1).max(50),
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(10000),
        // A page's worth rather than a line's. Still bounded: it is written by
        // an admin, stored as HTML and rendered to every visitor.
        details: z.string().max(50000).optional().nullable(),
        coverImage: z.string().max(500).optional().nullable(),
        type: z.string().max(50).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        publishAt: z.string().datetime().optional().nullable(),
    });
    const validation = schema.safeParse(body);
    if (!validation.success) return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });

    const { version, title, content, details, coverImage, type, color, publishAt } = validation.data;

    const entry = await prisma.changelogEntry.create({
        data: {
            version,
            title,
            slug: entrySlug(title),
            content: content,
            // Sanitised like any other HTML an admin writes: it is rendered to
            // every visitor, and an admin account is a trust boundary, not a
            // guarantee.
            details: details ? details : null,
            coverImage: coverImage || null,
            type: type || "update",
            color: color || "#3b82f6",
            publishAt: publishAt ? new Date(publishAt) : null,
        },
    });

    // Fire hook for cross-module reactions
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("changelog.entry.published", entry);

    // Public activity feed entry
    await prisma.activityFeedItem.create({
        data: {
            type: "changelog.entry.published",
            actorId: session.user.id,
            title: `Changelog ${entry.version}: ${entry.title}`,
            href: `/changelog`,
            icon: "GitBranch",
            isPublic: true,
        },
    }).catch(() => {});

    return NextResponse.json({ entry }, { status: 201 });
}
