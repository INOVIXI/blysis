import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/core/sdk/server";
import { readTable } from "../../lib/read-table";

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

    if (!slug && !subject) {
        const tables = await prisma.comparisonTable.findMany({
            where: { isActive: true },
            orderBy: [{ order: "asc" }, { title: "asc" }],
            select: { slug: true, title: true, description: true },
            take: 50,
        });
        return NextResponse.json({ tables }, { headers: { "Cache-Control": "public, max-age=60" } });
    }

    // The reader's language, because a column's note is prose its owner
    // writes and this route has no locale in its path to infer one from.
    const locale = request.nextUrl.searchParams.get("locale") ?? undefined;
    const table = await readTable({ slug: slug ?? undefined, subject: subject ?? undefined, locale });
    if (!table) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(
        { table },
        // A table of typed columns says the same thing for a minute. One whose
        // columns are things for sale does not.
        { headers: { "Cache-Control": table.subjectRef ? "no-store" : "public, max-age=60" } },
    );
}
