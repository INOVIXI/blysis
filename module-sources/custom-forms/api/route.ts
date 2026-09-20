import { NextRequest, NextResponse } from "next/server";
import { generateSlug } from "@/core/sdk";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { formCreateSchema } from "../lib/validations";

/**
 * GET /api/v1/forms - the forms still taking answers, and the panel's list.
 *
 * The panel read the reader's answer, so a form an operator closed left the
 * one screen that could open it again.
 */
export async function GET(request: NextRequest) {
    if (new URL(request.url).searchParams.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        const all = await prisma.customForm.findMany({
            select: { id: true, title: true, slug: true, description: true, isActive: true },
            orderBy: { createdAt: "desc" },
            take: 500,
        });
        return NextResponse.json({ forms: all });
    }

    const forms = await prisma.customForm.findMany({
        where: { isActive: true },
        select: { id: true, title: true, slug: true, description: true },
        orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ forms });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = formCreateSchema.safeParse(jsonBody);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
    }
    const { title, description, fields } = parsed.data;

    const slug = generateSlug(title);
    const form = await prisma.customForm.create({
        data: { title, slug, description: description || null, fields },
    });

    // Fire hook for cross-module reactions
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("customforms.form.created", form);

    return NextResponse.json({ form }, { status: 201 });
}
