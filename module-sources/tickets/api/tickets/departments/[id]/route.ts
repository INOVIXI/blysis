import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { ticketDepartmentUpdateSchema } from "../../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "tickets.departments"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const parsed = ticketDepartmentUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.name !== undefined) data.name = fields.name;
    if (fields.description !== undefined) data.description = fields.description;
    if (fields.color !== undefined) data.color = fields.color;
    if (fields.order !== undefined) data.order = fields.order;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;

    const department = await prisma.ticketDepartment.update({ where: { id }, data });
    return NextResponse.json({ department });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "tickets.departments"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.ticketDepartment.findUnique({
        where: { id },
        include: { _count: { select: { tickets: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Department not found" }, { status: 404 });
    if (existing._count.tickets > 0) {
        // Raw Prisma FK errors leaked as 500 before - now return a clear 409.
        return NextResponse.json(
            { error: `Cannot delete: department has ${existing._count.tickets} ticket(s). Move them to another department or close them first.`, code: "department_has_tickets" },
            { status: 409 },
        );
    }

    await prisma.ticketDepartment.delete({ where: { id } });
    return NextResponse.json({ ok: true });
}
