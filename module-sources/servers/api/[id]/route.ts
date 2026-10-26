import { NextRequest, NextResponse } from "next/server";
import { encryptSecret, isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { serverUpdateSchema } from "../../lib/validations";
import { SERVER_PUBLIC_FIELDS } from "../../lib/server-fields";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = serverUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.name !== undefined) data.name = fields.name;
    if (fields.type !== undefined) data.type = fields.type;
    if (fields.host !== undefined) data.host = fields.host;
    if (fields.port !== undefined) data.port = fields.port;
    if (fields.rconPort !== undefined) data.rconPort = fields.rconPort;
    if (fields.rconPassword !== undefined) {
        // Encrypt at rest. Empty/null clears the field; any non-empty value
        // is wrapped via AES-256-GCM (see secret-storage.ts).
        data.rconPassword = fields.rconPassword ? encryptSecret(fields.rconPassword) : null;
    }
    if (fields.queryPort !== undefined) data.queryPort = fields.queryPort;
    if (fields.isDefault !== undefined) data.isDefault = fields.isDefault;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;
    if (fields.order !== undefined) data.order = fields.order;
    if (fields.description !== undefined) data.description = fields.description || null;
    if (fields.image !== undefined) data.image = fields.image || null;
    const server = await prisma.gameServer.update({ where: { id }, data, select: SERVER_PUBLIC_FIELDS });
    return NextResponse.json({ server });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    await prisma.gameServer.delete({ where: { id } });
    return NextResponse.json({ message: "Server deleted" });
}
