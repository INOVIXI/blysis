import { NextRequest, NextResponse } from "next/server";
import { downloadSlug } from "../../lib/guide";
import { isAdmin, prisma, rateLimitForRoleAsync, readJsonBody, getClientIP } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { canDownload } from "../../lib/can-download";
import { z } from "zod";

/**
 * What an edit may write, bounded the way a create is.
 *
 * These were unbounded while the create path capped every one of them, so a
 * title that could not be created could be edited into place afterwards - and
 * the column takes it. The two paths now agree, plus the switch and the two
 * fields only an edit reaches.
 */
const downloadUpdateSchema = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2_000).nullable().optional(),
    details: z.string().max(50_000).nullable().optional(),
    coverImage: z.string().max(500).nullable().optional(),
    fileName: z.string().trim().min(1).max(255).optional(),
    fileUrl: z.string().trim().min(1).max(2_000).optional(),
    fileSize: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    isActive: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

// GET - Increment download count and return file URL
export async function GET(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;

    const session = await auth();
    const ip = getClientIP(request.headers);
    const rlKey = `download:${session?.user?.id ?? "anon"}:${ip}`;
    const allowed = await rateLimitForRoleAsync(
        rlKey,
        { maxRequests: 30, windowMs: 60_000 },
        session?.user?.role
    );
    if (!allowed) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const download = await prisma.download.findUnique({ where: { id } });
    if (!download) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Validate URL to prevent path traversal and SSRF
    if (download.fileUrl && !download.fileUrl.startsWith('https://')) {
        return NextResponse.json({ error: "Invalid download URL" }, { status: 400 });
    }

    // Granular gate - if any ResourcePermission rows exist for this specific
    // download, require the caller to have been granted access. When no
    // grants exist, the download remains open (existing behavior preserved).
    const restricted = await prisma.resourcePermission.count({
        where: { resource: "downloads.download", resourceId: id },
    });
    if (restricted > 0) {
        if (!(await canDownload(session?.user?.id, id))) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    }

    await prisma.download.update({ where: { id }, data: { downloads: { increment: 1 } } });

    // Fire hook + activity feed entry
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("downloads.file.downloaded", {
        downloadId: download.id,
        title: download.title,
        fileName: download.fileName,
        userId: session?.user?.id ?? null,
    });
    if (session?.user?.id) {
        await prisma.activityFeedItem.create({
            data: {
                type: "downloads.file.downloaded",
                actorId: session.user.id,
                title: `Downloaded ${download.title}`,
                icon: "Download",
                isPublic: true,
            },
        }).catch(() => {});
    }

    return NextResponse.json({ url: download.fileUrl });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = downloadUpdateSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }
    // The slug follows the title so a renamed file reads correctly in a URL,
    // while the number in front of it keeps every shared link working. The
    // guide is sanitised on the way in, like the one the create path writes.
    const { title, details, ...rest } = validation.data;
    const download = await prisma.download.update({
        where: { id },
        data: {
            ...rest,
            ...(title !== undefined ? { title, slug: downloadSlug(title) } : {}),
            ...(details !== undefined ? { details: details ? details : null } : {}),
        },
    });
    return NextResponse.json({ download });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    await prisma.download.delete({ where: { id } });
    return NextResponse.json({ message: "Deleted" });
}
