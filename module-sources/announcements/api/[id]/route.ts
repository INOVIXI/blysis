import { NextRequest, NextResponse } from "next/server";
import { isAdmin, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { announcementUpdateSchema } from "../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const parsed = announcementUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.title !== undefined) data.title = fields.title;
    if (fields.content !== undefined) data.content = fields.content;
    if (fields.type !== undefined) data.type = fields.type;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;
    if (fields.dismissible !== undefined) data.dismissible = fields.dismissible;
    if (fields.includePages !== undefined) data.includePages = fields.includePages || null;
    if (fields.excludePages !== undefined) data.excludePages = fields.excludePages || null;
    if (fields.startsAt !== undefined) data.startsAt = fields.startsAt ? new Date(fields.startsAt) : null;
    if (fields.endsAt !== undefined) data.endsAt = fields.endsAt ? new Date(fields.endsAt) : null;
    if (fields.publishAt !== undefined) data.publishAt = fields.publishAt ? new Date(fields.publishAt) : null;

    const announcement = await prisma.announcement.update({ where: { id }, data });

    await logActivity({
        userId: session.user.id,
        action: "announcement_updated",
        metadata: { description: `Updated: ${id}` },
    });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("announcements.announcement.updated", announcement);

    return NextResponse.json({ announcement });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.announcement.findUnique({ where: { id } });
    await prisma.announcement.delete({ where: { id } });

    await logActivity({
        userId: session.user.id,
        action: "announcement_deleted",
        metadata: { description: `Deleted: ${id}` },
    });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("announcements.announcement.deleted", existing);

    return NextResponse.json({ message: "Deleted" });
}
