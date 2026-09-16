import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";
import { entrySlug } from "../../lib/entry-page";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const existing = await prisma.changelogEntry.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Snapshot the previous state before update
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("changelog.entry", id, existing, "update", session.user.id);

    // Everything POST accepts, each field optional, plus the two an edit can
    // reach that a create cannot. This used to be `{ ...body }` handed
    // straight to Prisma, which let an admin write any column on the model -
    // `id`, so the revision rows recorded against the old one no longer found
    // it, and `createdAt`, which is what the public list orders by - while
    // skipping every bound POST enforces on the same fields. Any key outside
    // this list was passed through to Prisma too and answered 500, because a
    // column it does not know is a validation error thrown, not returned.
    // Zod strips what it does not name, so unknown keys are simply dropped.
    const patchSchema = z.object({
        version: z.string().min(1).max(50),
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(10000),
        details: z.string().max(50000).nullable(),
        coverImage: z.string().max(500).nullable(),
        type: z.string().max(50),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        isActive: z.boolean(),
        publishAt: z.string().datetime().nullable(),
    }).partial();

    const validation = patchSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }

    const { content, details, publishAt, title, ...rest } = validation.data;
    const patchData = {
        ...rest,
        ...(title !== undefined ? { title, slug: entrySlug(title) } : {}),
        ...(content !== undefined ? { content: content } : {}),
        // Sanitised on the way in like the summary beside it. The slug follows
        // the title so a renamed release reads correctly in a URL, while the
        // number in front of it keeps every shared link working.
        ...(details !== undefined ? { details: details ? details : null } : {}),
        ...(publishAt !== undefined ? { publishAt: publishAt ? new Date(publishAt) : null } : {}),
    };
    const entry = await prisma.changelogEntry.update({ where: { id }, data: patchData });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("changelog.entry.updated", entry);

    return NextResponse.json({ entry });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.changelogEntry.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Snapshot the deleted entry for potential restore
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("changelog.entry", id, existing, "delete", session.user.id);

    await prisma.changelogEntry.delete({ where: { id } });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("changelog.entry.deleted", existing);

    return NextResponse.json({ message: "Deleted" });
}
