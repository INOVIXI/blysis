import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { customPageUpdateSchema } from "../../lib/validations";

type RouteParams = { params: Promise<{ slug: string }> };

// GET /api/v1/custom-pages/[slug] - Public
export async function GET(request: NextRequest, { params }: RouteParams) {
    const { slug } = await params;
    const page = await prisma.customPage.findFirst({
        where: { OR: [{ slug }, { id: slug }], isActive: true },
    });
    if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });
    return NextResponse.json({ page });
}

// PATCH /api/v1/custom-pages/[slug] - Admin
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { slug } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const page = await prisma.customPage.findFirst({ where: { OR: [{ slug }, { id: slug }] } });
    if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    const parsed = customPageUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.title !== undefined) data.title = fields.title;
    if (fields.content !== undefined) data.content = fields.content;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;
    if (fields.order !== undefined) data.order = fields.order;

    // Snapshot the previous state before update
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("custom-pages.page", page.id, page, "update", session.user.id);

    const updated = await prisma.customPage.update({ where: { id: page.id }, data });
    return NextResponse.json({ page: updated });
}

// DELETE /api/v1/custom-pages/[slug] - Admin
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { slug } = await params;
    const page = await prisma.customPage.findFirst({ where: { OR: [{ slug }, { id: slug }] } });
    if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    // Snapshot the deleted page for potential restore
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("custom-pages.page", page.id, page, "delete", session.user.id);

    await prisma.customPage.delete({ where: { id: page.id } });
    return NextResponse.json({ message: "Page deleted" });
}
