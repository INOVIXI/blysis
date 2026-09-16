import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalisedMatrix, type MatrixRule } from "@/core/sdk";
import { hasPermission, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { checkFields, usableOptions } from "../../../../../lib/field-draft";

/**
 * What one department asks, and who may open a ticket in it.
 *
 * Both are written whole and in one transaction. A form saved a question at a
 * time can be filled in halfway through by somebody the department is about to
 * stop admitting, and a permission list saved a row at a time is a department
 * briefly open to the wrong people. Neither is a state worth being able to
 * reach.
 *
 * The rules for both live outside this file on purpose. `field-draft.ts` says
 * what may be asked, and `normalisedMatrix` in the SDK says what a permission
 * grid sends - the same function the forum's grid uses, because the thing that
 * would drift between two copies is whether unticking everybody opens the
 * container to the world.
 */
type RouteParams = { params: Promise<{ id: string }> };

const setupSchema = z.object({
    fields: z.array(z.object({
        key: z.string().max(64),
        label: z.string().max(160),
        type: z.enum(["text", "select"]).default("text"),
        required: z.boolean().default(false),
        options: z.array(z.string().max(120)).max(50).default([]),
    })).max(50),
    /** Absent leaves the permissions alone; empty removes them. */
    permissions: z.array(z.object({
        roleId: z.string().min(1).max(64),
        canView: z.boolean(),
        canPost: z.boolean(),
        canReply: z.boolean(),
    })).max(100).optional(),
});

async function requireAdmin() {
    const session = await auth();
    if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    if (!(await hasPermission(session.user.id, "tickets.departments"))) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    return { session };
}

/**
 * Everything the editor needs, narrowed by nothing.
 *
 * The list of departments a member sees is narrowed by the very permissions
 * this screen writes, so an admin who has just unticked their own role would
 * lose the department they need to untick it back in.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const { id } = await params;
    const [department, fields, permissions, roles] = await Promise.all([
        prisma.ticketDepartment.findUnique({
            where: { id },
            select: { id: true, name: true, description: true, isActive: true },
        }),
        prisma.ticketDepartmentField.findMany({ where: { departmentId: id }, orderBy: { order: "asc" }, take: 50 }),
        prisma.ticketDepartmentPermission.findMany({ where: { departmentId: id }, take: 200 }),
        prisma.role.findMany({
            select: { id: true, name: true, displayName: true },
            orderBy: { priority: "desc" },
            take: 200,
        }),
    ]);
    if (!department) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(
        { department, fields, permissions, roles },
        { headers: { "Cache-Control": "private, no-store" } },
    );
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const department = await prisma.ticketDepartment.findUnique({ where: { id }, select: { id: true } });
    if (!department) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const fields = parsed.data.fields.map((field) => ({
        key: field.key.trim(),
        label: field.label.trim(),
        type: field.type,
        required: field.required,
        options: usableOptions(field.options),
    }));

    const refusal = checkFields(fields);
    if (refusal) {
        return NextResponse.json(
            { error: "That question would not work", code: `field_${refusal.reason}`, key: refusal.key },
            { status: 400 },
        );
    }

    const matrix: MatrixRule[] | null = parsed.data.permissions
        ? normalisedMatrix(parsed.data.permissions)
        : null;

    await prisma.$transaction(async (tx) => {
        await tx.ticketDepartmentField.deleteMany({ where: { departmentId: id } });
        if (fields.length > 0) {
            await tx.ticketDepartmentField.createMany({
                data: fields.map((field, at) => ({ ...field, departmentId: id, order: at })),
            });
        }

        // Absent leaves them alone: a screen saving only the questions must not
        // clear a department's permissions as a side effect.
        if (matrix === null) return;
        await tx.ticketDepartmentPermission.deleteMany({ where: { departmentId: id } });
        if (matrix.length > 0) {
            await tx.ticketDepartmentPermission.createMany({
                data: matrix.map((rule) => ({ ...rule, departmentId: id })),
            });
        }
    });

    logActivity({
        userId: guard.session?.user?.id,
        action: "tickets.department.setup",
        entity: "ticket_department",
        entityId: id,
        metadata: { fields: fields.length, permissions: matrix?.length ?? null },
    }).catch(() => {});

    return NextResponse.json({ saved: true });
}
