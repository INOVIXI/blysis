import { NextRequest, NextResponse } from "next/server";
import { hasPermission, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { creditPackageSchema } from "../../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = creditPackageSchema.partial().safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const updated = await prisma.creditPackage.updateMany({ where: { id }, data: parsed.data });
    if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await logActivity({
        userId: session.user.id,
        action: "store.credit_package.updated",
        entity: "credit_package",
        entityId: id,
    }).catch(() => {});

    const pack = await prisma.creditPackage.findUnique({ where: { id } });
    return NextResponse.json({ package: pack });
}

/**
 * Switched off rather than deleted.
 *
 * A package id is on every payment that bought it, and a settlement arriving
 * after the row is gone has nothing to name. Off is what an operator means by
 * "stop selling it".
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const off = await prisma.creditPackage.updateMany({ where: { id }, data: { isActive: false } });
    if (off.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await logActivity({
        userId: session.user.id,
        action: "store.credit_package.retired",
        entity: "credit_package",
        entityId: id,
    }).catch(() => {});

    return NextResponse.json({ retired: true });
}
