import { NextRequest, NextResponse } from "next/server";
import { attachContentTranslations, contentTranslationsInput, deleteContentTranslations, isAdmin, prisma, readJsonBody, saveContentTranslations, translateContent } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { CUSTOM_PAGE_TEXT, TRANSLATED_FIELDS, customPageUpdateSchema } from "../../lib/validations";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * GET /api/v1/custom-pages/[slug] - a published page, in `?locale=`.
 *
 * A reader is given the title and the body in their language, and the
 * original where the admin wrote no translation. `scope=admin` is the
 * editor's answer: a draft too, with every language beside the originals,
 * refused to anybody who could not open the editor. The editor used to read
 * the published answer, so a draft could not be opened to be finished.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
    const { slug } = await params;
    const query = new URL(request.url).searchParams;
    if (query.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        const draft = await prisma.customPage.findFirst({ where: { OR: [{ slug }, { id: slug }] } });
        if (!draft) return NextResponse.json({ error: "Page not found" }, { status: 404 });
        const [page] = await attachContentTranslations(prisma, CUSTOM_PAGE_TEXT, [draft]);
        return NextResponse.json({ page });
    }

    const found = await prisma.customPage.findFirst({
        where: { OR: [{ slug }, { id: slug }], isActive: true },
    });
    if (!found) return NextResponse.json({ error: "Page not found" }, { status: 404 });
    const [page] = await translateContent(prisma, CUSTOM_PAGE_TEXT, [found], ["title", "content"], query.get("locale") ?? "");
    return NextResponse.json({ page });
}

// PATCH /api/v1/custom-pages/[slug] - Admin
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { slug } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const page = await prisma.customPage.findFirst({ where: { OR: [{ slug }, { id: slug }] } });
    if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    const parsed = customPageUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.title !== undefined) data.title = fields.title;
    if (fields.content !== undefined) data.content = fields.content;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;
    if (fields.order !== undefined) data.order = fields.order;

    // Snapshot the previous state before update
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("custom-pages.page", page.id, page, "update", session.user.id);

    const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.customPage.update({ where: { id: page.id }, data });
        if (translations.value) await saveContentTranslations(tx, { ...CUSTOM_PAGE_TEXT, recordId: page.id }, translations.value);
        return row;
    });
    return NextResponse.json({ page: updated });
}

// DELETE /api/v1/custom-pages/[slug] - Admin
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { slug } = await params;
    const page = await prisma.customPage.findFirst({ where: { OR: [{ slug }, { id: slug }] } });
    if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    // Snapshot the deleted page for potential restore
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("custom-pages.page", page.id, page, "delete", session.user.id);

    await prisma.$transaction(async (tx) => {
        await tx.customPage.delete({ where: { id: page.id } });
        await deleteContentTranslations(tx, CUSTOM_PAGE_TEXT, [page.id]);
    });
    return NextResponse.json({ message: "Page deleted" });
}
