/**
 * Every product, including the ones that are switched off.
 *
 * The public listing at /api/v1/store/products answers the same thing to
 * everybody, which is what lets a proxy in front of the site hold it. The
 * screen an operator manages products from needs to see what is not on sale,
 * and that is a different question with a different answer per role, so it is
 * a different endpoint: checked, and never offered to a shared cache.
 */
import { NextRequest, NextResponse } from "next/server";
import { hasPermission, log, pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

/** This answer depends on who asked, so nothing may keep a copy of it. */
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
    }
    if (!(await hasPermission(session.user.id, "store.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE });
    }

    try {
        const searchParams = request.nextUrl.searchParams;
        const { page, limit, skip, take } = pageParams(searchParams, { defaultLimit: 20 });
        const category = searchParams.get("category");
        const search = searchParams.get("search") || "";
        /*
         * Naming a set of products outright, for a field that holds several
         * of them: what was chosen last month is not on the first page of a
         * list ordered by when it was made, and a chip that cannot say its
         * name is an id on the screen.
         */
        const ids = (searchParams.get("ids") || "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
            .slice(0, 100);

        const where = {
            ...(ids.length > 0 && { id: { in: ids } }),
            ...(category && { category: { slug: category } }),
            ...(search && {
                OR: [
                    { name: { contains: search, mode: "insensitive" as const } },
                    { description: { contains: search, mode: "insensitive" as const } },
                ],
            }),
        };

        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where,
                include: { category: { select: { id: true, name: true, slug: true } } },
                orderBy: { createdAt: "desc" },
                skip,
                take,
            }),
            prisma.product.count({ where }),
        ]);

        return NextResponse.json({
            products,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        }, { headers: PRIVATE });
    } catch (error) {
        log.error("List products for an operator failed", {
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: PRIVATE });
    }
}
