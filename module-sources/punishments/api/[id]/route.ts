import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { punishmentUpdateSchema } from "../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = punishmentUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.reason !== undefined) data.reason = fields.reason;
    if (fields.active !== undefined) data.active = fields.active;
    if (fields.duration !== undefined) data.duration = fields.duration;
    if (fields.expiresAt !== undefined) data.expiresAt = fields.expiresAt ? new Date(fields.expiresAt) : null;

    /*
     * Who lifted it is taken from the session, never from the body: a name a
     * caller can choose is a name a caller can put somebody else's staff on.
     * Restoring clears both, because a punishment that is standing again was
     * not lifted by anybody.
     */
    if (fields.active === false) {
        data.liftedBy = session.user.name ?? session.user.email ?? null;
        data.liftReason = fields.liftReason?.trim() || null;
    } else if (fields.active === true) {
        data.liftedBy = null;
        data.liftReason = null;
    }

    const punishment = await prisma.punishment.update({ where: { id }, data });

    // If the punishment was revoked (active → false), fire revoke hook + feed
    if (fields.active === false) {
        const { doActionAsync } = await import("@/core/sdk");
        await doActionAsync("punishments.punishment.revoked", {
            punishmentId: punishment.id,
            playerName: punishment.playerName,
            type: punishment.type,
            revokedBy: session.user.id,
            liftedBy: punishment.liftedBy,
            liftReason: punishment.liftReason,
        });
        await prisma.activityFeedItem.create({
            data: {
                type: "punishments.punishment.revoked",
                actorId: session.user.id,
                title: `${punishment.type} revoked for ${punishment.playerName}`,
                icon: "AlertTriangle",
                isPublic: false,
            },
        }).catch(() => {});
    }

    return NextResponse.json({ punishment });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const punishment = await prisma.punishment.findUnique({ where: { id } });
    await prisma.punishment.delete({ where: { id } });

    if (punishment) {
        const { doActionAsync } = await import("@/core/sdk");
        await doActionAsync("punishments.punishment.revoked", {
            punishmentId: punishment.id,
            playerName: punishment.playerName,
            type: punishment.type,
            revokedBy: session.user.id,
        });
        await prisma.activityFeedItem.create({
            data: {
                type: "punishments.punishment.revoked",
                actorId: session.user.id,
                title: `${punishment.type} revoked for ${punishment.playerName}`,
                icon: "AlertTriangle",
                isPublic: false,
            },
        }).catch(() => {});
    }

    return NextResponse.json({ message: "Deleted" });
}
