import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { creatorCodeUpdateSchema } from "../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.creatorCode.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Creator code not found" }, { status: 404 });

    const body = await readJsonBody(request, { fallback: {} });
    if (body instanceof NextResponse) return body;
    const parsed = creatorCodeUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.code !== undefined) data.code = fields.code;
    if (fields.creatorId !== undefined) data.creatorId = fields.creatorId;
    if (fields.discountPercent !== undefined) data.discountPercent = fields.discountPercent;
    if (fields.commissionPercent !== undefined) data.commissionPercent = fields.commissionPercent;
    if (fields.productIds !== undefined) data.productIds = fields.productIds;
    if (fields.categoryIds !== undefined) data.categoryIds = fields.categoryIds;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;

    const code = await prisma.creatorCode.update({ where: { id }, data });
    return NextResponse.json({ code });
}

export async function DELETE(_: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.creatorCode.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Creator code not found" }, { status: 404 });

    await prisma.creatorCode.delete({ where: { id } });
    return NextResponse.json({ message: "Deleted" });
}
