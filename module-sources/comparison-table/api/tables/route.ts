import { NextRequest, NextResponse } from "next/server";
import { prisma, translateContent } from "@/core/sdk/server";
import { readTable } from "../../lib/read-table";
import { TABLE_TEXT } from "../../lib/table-text";

/**
 * GET /api/v1/comparison-tables?slug=... - one table, ready to draw.
 * GET /api/v1/comparison-tables?subject=... - the table about one thing.
 *
 * The whole table in one answer: a reader comparing five plans across twenty
 * features should not cost a hundred requests.
 *
 * The subject form is what a shelf drawn as a comparison asks, and it is not
 * cached: its columns are products, with prices that a campaign or a sale
 * window can change between one minute and the next, and a shop showing last
 * minute's price is worse than a shop that is slow.
 */
export async function GET(request: NextRequest) {
    const slug = request.nextUrl.searchParams.get("slug");
    const subject = request.nextUrl.searchParams.get("subject");

    // The reader's language, because every label is prose an operator writes
    // and this route has no locale in its path to infer one from. It is in
    // the address, so a cache keeps one answer per language.
    const locale = request.nextUrl.searchParams.get("locale") ?? undefined;

    if (!slug && !subject) {
        const found = await prisma.comparisonTable.findMany({
            where: { isActive: true },
            orderBy: [{ order: "asc" }, { title: "asc" }],
            select: { id: true, slug: true, title: true, description: true },
            take: 50,
        });
        const tables = (await translateContent(prisma, TABLE_TEXT, found, ["title", "description"], locale ?? ""))
            .map(({ id: _id, ...table }) => table);
        return NextResponse.json({ tables }, { headers: { "Cache-Control": "public, max-age=60" } });
    }

    const table = await readTable({ slug: slug ?? undefined, subject: subject ?? undefined, locale });
    if (!table) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(
        { table },
        // A table of typed columns says the same thing for a minute. One whose
        // columns are things for sale does not.
        { headers: { "Cache-Control": table.subjectRef ? "no-store" : "public, max-age=60" } },
    );
}
