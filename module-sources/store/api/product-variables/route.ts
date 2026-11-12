import { NextRequest, NextResponse } from "next/server";
import { contentTranslationsInput, hasPermission, isModuleEnabled, prisma, readJsonBody, saveContentTranslations, translateContent } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { productVariableSchema } from "../../lib/validations";
import { VARIABLE_FIELDS, VARIABLE_TEXT, localeOf } from "../../lib/store-text";

// GET ?productId=xxx (public for checkout, admin for all). The label and the
// placeholder are read in `?locale=`, and in the original where the operator
// wrote no translation.
export async function GET(request: NextRequest) {
    if (!(await isModuleEnabled("store"))) return NextResponse.json({ error: "Store module is disabled" }, { status: 404 });

    const productId = request.nextUrl.searchParams.get("productId");
    if (!productId) return NextResponse.json({ error: "productId required" }, { status: 400 });

    const variables = await prisma.productVariable.findMany({
        where: { productId },
    });
    return NextResponse.json({ variables: await translateContent(prisma, VARIABLE_TEXT, variables, ["label", "placeholder"], localeOf(request)) });
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
    const translations = contentTranslationsInput(jsonBody, VARIABLE_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const { productId, name, label, type, required, placeholder, options } = parsed.data;

    const variable = await prisma.$transaction(async (tx) => {
        const created = await tx.productVariable.create({ data: {
            productId, name, label,
            type: type || "text",
            required: required ?? true,
            placeholder: placeholder || null,
            options: options || null,
        } });
        if (translations.value) await saveContentTranslations(tx, { ...VARIABLE_TEXT, recordId: created.id }, translations.value);
        return created;
    });
    return NextResponse.json({ variable }, { status: 201 });
}
