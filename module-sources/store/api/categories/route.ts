import { NextRequest, NextResponse } from "next/server";
import { slugify } from "@/core/sdk";
import { hasPermission, log, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { categorySchema } from "../../lib/validations";
import { anyCategoryGated, gateProductIds, visibleCategories } from "../../lib/category-visibility";
import { stillOwnedWhere } from "../../lib/ownership";

/**
 * GET /api/v1/store/categories - the shelves a reader may see.
 *
 * Shared by everybody until an operator gates a shelf, and only then per
 * reader. A shop that gates nothing - which is nearly all of them - keeps an
 * answer any cache in front of the site can hold; a shop that gates one shelf
 * pays for it with an answer nothing may keep, because keeping it would serve
 * one member's shelves to the next visitor.
 */
export async function GET(request: NextRequest) {
    /*
     * The operator's answer, and it is deliberately not the shopper's with a
     * flag on it: the shopper's is shaped by who is asking - gated shelves,
     * live product counts - and an operator managing shelves wants the shelves,
     * all of them, in the order they are in. It also carries none of the cache
     * headers below, because it varies by caller.
     */
    if (new URL(request.url).searchParams.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        // The permission the writes below answer to: seeing every shelf and
        // rearranging them are the same job.
        if (!(await hasPermission(session.user.id, "store.manage"))) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const all = await prisma.category.findMany({
            include: {
                _count: { select: { products: true } },
                children: { select: { id: true, name: true, slug: true, image: true, description: true } },
            },
            orderBy: { order: "asc" },
        });
        return NextResponse.json({ categories: all });
    }

    try {
        const categories = await prisma.category.findMany({
            where: { isActive: true },
            include: {
                _count: {
                    select: { products: { where: { isActive: true } } },
                },
                children: {
                    where: { isActive: true },
                    select: { id: true, name: true, slug: true, image: true, description: true },
                },
            },
            orderBy: { order: "asc" },
        });

        if (!anyCategoryGated(categories)) {
            return NextResponse.json({ categories });
        }

        const session = await auth();
        const userId = session?.user?.id ?? null;
        const owned = userId
            ? await prisma.ownedProduct.findMany({
                where: {
                    ...stillOwnedWhere(userId, new Date()),
                    productId: { in: gateProductIds(categories) },
                },
                select: { productId: true },
            })
            : [];

        const visible = visibleCategories(categories, new Set(owned.map((row) => row.productId)));
        // A shelf hidden from the parent list must not come back as somebody
        // else's child.
        const shownIds = new Set(visible.map((category) => category.id));
        return NextResponse.json(
            {
                categories: visible.map((category) => ({
                    ...category,
                    children: category.children.filter((child) => shownIds.has(child.id)),
                })),
            },
            { headers: { "Cache-Control": "private, no-store" } },
        );
    } catch (error) {
        log.error("List categories error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// POST /api/v1/store/categories - Create category (admin)
export async function POST(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const adminCheck = await hasPermission(session.user.id, "store.manage");
        if (!adminCheck) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = await readJsonBody(request);
        if (body instanceof NextResponse) return body;
        const validation = categorySchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error.issues[0].message },
                { status: 400 }
            );
        }

        const data = validation.data;
        const slug = data.slug || slugify(data.name);

        const existing = await prisma.category.findUnique({ where: { slug } });
        if (existing) {
            return NextResponse.json(
                { error: "A category with this slug already exists" },
                { status: 400 }
            );
        }

        /*
         * Named one by one rather than spread, so a column is never written
         * from a field the schema happens to accept. The cost of that is a
         * list somebody has to remember to add to, and `layout` was never
         * added: every category made through the panel came out a grid
         * whatever the operator chose, and the only way to get a comparison
         * table was to create the shelf and then edit it. `a-shelf-keeps-
         * what-it-was-given` is what notices the next time.
         */
        const category = await prisma.category.create({
            data: {
                name: data.name,
                slug,
                description: data.description,
                image: data.image,
                parentId: data.parentId,
                order: data.order ?? 0,
                isActive: data.isActive ?? true,
                layout: data.layout ?? "grid",
                visibleAfterProductIds: data.visibleAfterProductIds ?? [],
            },
        });

        return NextResponse.json({ category }, { status: 201 });
    } catch (error) {
        log.error("Create category error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
