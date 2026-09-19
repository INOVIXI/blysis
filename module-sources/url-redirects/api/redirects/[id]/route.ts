import { NextRequest, NextResponse } from "next/server";
import { isAdmin, invalidate, logActivity, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * DELETE /api/v1/url-redirects/[id] - take a sign off a door.
 *
 * The module shipped a list and a form to add to it and nothing else, so a
 * rule written by mistake was permanent as far as the panel was concerned:
 * the only way out was the database.
 *
 * Two things have to happen with the row, and either alone is a bug an
 * operator would report as "it did not work". Core holds the rules for a
 * minute, so one deleted and not forgotten keeps sending visitors somewhere;
 * and a redirect is a change to what the site does with an address, which is
 * what the activity log exists to record.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    // Read before the delete, so a rule that is not there answers 404 rather
    // than the 500 Prisma raises for deleting nothing - and so the log line
    // can say which address stopped being redirected.
    const existing = await prisma.urlRedirect.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.urlRedirect.delete({ where: { id } });
    await invalidate("blysis:routing:redirects");

    await logActivity({
        userId: session.user.id,
        action: "url_redirects.deleted",
        entity: "url_redirect",
        entityId: id,
        metadata: { from: existing.from, to: existing.to },
    }).catch(() => {});

    return NextResponse.json({ ok: true });
}
