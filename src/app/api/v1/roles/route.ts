import { NextRequest, NextResponse } from "next/server";
import { safeRoleCss } from "@/core/lib/role-css";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { isAdmin } from "@/core/lib/permissions";
import { roleSchema } from "@/core/lib/validations";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";

// GET /api/v1/roles - List all roles
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const roles = await prisma.role.findMany({
        include: {
            permissions: true,
            _count: { select: { users: true } },
        },
        orderBy: { priority: "desc" },
    });

    return NextResponse.json({ roles });
}

// POST /api/v1/roles - Create role
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = roleSchema.safeParse(body);

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

    const { name, displayName, color, priority, permissions, nameCss, badgeCss } = validation.data;

    const existing = await prisma.role.findUnique({ where: { name } });
    if (existing) {
        return NextResponse.json({ error: "Role name already exists" }, { status: 400 });
    }

    const role = await prisma.role.create({
        data: {
            name,
            displayName,
            nameCss: nameCss ?? null,
            badgeCss: badgeCss ?? null,
            color,
            priority: priority || 0,
            rolePermissions: permissions?.length
                ? {
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
        action: "role.create",
        entity: "role",
        entityId: role.id,
        metadata: { name: role.name, displayName: role.displayName, priority: role.priority },
    }).catch(() => {});

    return NextResponse.json({ role }, { status: 201 });
}
