import { NextRequest, NextResponse } from "next/server";
import { hasPermission, isModuleEnabled, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { productCommandSchema } from "../../lib/validations";

// GET ?productId=xxx
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (!(await isModuleEnabled("store"))) return NextResponse.json({ error: "Store module is disabled" }, { status: 404 });

    const productId = request.nextUrl.searchParams.get("productId");
    if (!productId) return NextResponse.json({ error: "productId required" }, { status: 400 });

    const commands = await prisma.productCommand.findMany({
        where: { productId },
        orderBy: { order: "asc" },
    });
    return NextResponse.json({ commands });
}

// POST
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = productCommandSchema.safeParse(jsonBody);
    if (!parsed.success) return NextResponse.json({ error: "productId and command required" }, { status: 400 });
    const { productId, command, order, serverId } = parsed.data;

    const cmd = await prisma.productCommand.create({
        data: { productId, command, serverId: serverId || null, order: order || 0 },
    });
    return NextResponse.json({ command: cmd }, { status: 201 });
}
