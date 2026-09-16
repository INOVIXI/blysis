import { NextRequest, NextResponse } from "next/server";
import { hasPermission, isModuleEnabled, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { productVariableSchema } from "../../lib/validations";

// GET ?productId=xxx (public for checkout, admin for all)
export async function GET(request: NextRequest) {
    if (!(await isModuleEnabled("store"))) return NextResponse.json({ error: "Store module is disabled" }, { status: 404 });

    const productId = request.nextUrl.searchParams.get("productId");
    if (!productId) return NextResponse.json({ error: "productId required" }, { status: 400 });

    const variables = await prisma.productVariable.findMany({
        where: { productId },
    });
    return NextResponse.json({ variables });
}

// POST - Admin
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = productVariableSchema.safeParse(jsonBody);
    if (!parsed.success) return NextResponse.json({ error: "productId, name, label required" }, { status: 400 });
    const { productId, name, label, type, required, placeholder, options } = parsed.data;

    const variable = await prisma.productVariable.create({
        data: {
            productId, name, label,
            type: type || "text",
            required: required ?? true,
            placeholder: placeholder || null,
            options: options || null,
        },
    });
    return NextResponse.json({ variable }, { status: 201 });
}
