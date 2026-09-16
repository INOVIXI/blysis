import { NextRequest, NextResponse } from "next/server";
import { safeRoleCss } from "@/core/lib/role-css";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { isAdmin } from "@/core/lib/permissions";
import { roleSchema } from "@/core/lib/validations";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";
import { purgeRolePrincipalRows } from "@/core/lib/principal-rows";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/v1/roles/[id] - Update role
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = roleSchema.partial().safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: validation.error.issues[0].message },
            { status: 400 }
        );
    }

    /*
     * A style is either safe to render or it is not stored. Refused rather
     * than quietly stripped: an operator who wrote a gradient and got a plain
     * name back would spend the afternoon wondering which browser was wrong.
     */
    for (const key of ["nameCss", "badgeCss"] as const) {
        const written = (validation.data as Record<string, unknown>)[key];
        if (typeof written === "string" && written.trim() !== "" && !safeRoleCss(written)) {
            return NextResponse.json(
                {
                    error: "That style cannot be used: it leaves the rule it is written in, or fetches something",
                    code: "role_css_unsafe",
                    field: key,
                },
                { status: 400 },
            );
        }
    }

    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) {
        return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    // Prevent editing the admin role name
    if (existing.name === "admin" && validation.data.name && validation.data.name !== "admin") {
        return NextResponse.json({ error: "Cannot rename the admin role" }, { status: 400 });
    }

    const { permissions, ...roleData } = validation.data;

    const role = await prisma.role.update({
        where: { id },
        data: {
            ...roleData,
            // Written whole: what arrives is the role's complete opinion, and
            // a name the screen left out is the third state rather than an
            // omission to merge with what was there before.
            rolePermissions: permissions
                ? {
                    deleteMany: {},
                    create: permissions.map((entry) => ({
                        permission: entry.name,
                        state: entry.state,
                    })),
                }
                : undefined,
        },
        include: { rolePermissions: true, _count: { select: { users: true } } },
    });

    logActivity({
        userId: session.user.id,
        action: "role.update",
        entity: "role",
        entityId: role.id,
        metadata: { name: role.name, changes: Object.keys(roleData) },
    }).catch(() => {});

    return NextResponse.json({ role });
}

// DELETE /api/v1/roles/[id] - Delete role
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await prisma.role.findUnique({
        where: { id },
        include: { _count: { select: { users: true } } },
    });

    if (!existing) {
        return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    if (existing.name === "admin") {
        return NextResponse.json({ error: "Cannot delete the admin role" }, { status: 400 });
    }

    if (existing._count.users > 0) {
        return NextResponse.json(
            { error: `Cannot delete role with ${existing._count.users} assigned users. Reassign them first.` },
            { status: 400 }
        );
    }

    await prisma.role.delete({ where: { id } });

    // `ResourcePermission` names its principal with a plain string, so the
    // delete above cascades nothing: a deleted role's grants stayed in the
    // table and showed in the admin list as a bare cuid.
    await purgeRolePrincipalRows(id);

    logActivity({
        userId: session.user.id,
        action: "role.delete",
        entity: "role",
        entityId: id,
        metadata: { name: existing.name },
    }).catch(() => {});

    return NextResponse.json({ message: "Role deleted" });
}
