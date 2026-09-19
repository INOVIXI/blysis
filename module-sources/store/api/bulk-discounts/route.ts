import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";

const bulkDiscountSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    minQuantity: z.number().int().min(1, "Min quantity must be at least 1"),
    discountPercent: z.number().min(0, "Discount cannot be negative").max(100, "Discount cannot exceed 100%"),
    productId: z.string().optional().nullable(),
    categoryId: z.string().optional().nullable(),
});

export async function GET() {
    /*
     * Every rule, not only the live ones.
     *
     * This filtered on `isActive` while the screen behind it offers a switch
     * for exactly that column: turning a discount off made its row vanish
     * from the only screen that could turn it back on. The public side asks
     * this endpoint too and does its own filtering, which is where the
     * filtering belongs.
     *
     * No join for the product or the category: `productId` and `categoryId`
     * on this model are plain strings with an index, not foreign keys, so
     * there is no relation to include and nothing stops a rule pointing at a
     * product that has been deleted. Making them real references is a
     * migration rather than a line here.
     */
    const discounts = await prisma.bulkDiscount.findMany({
        orderBy: { minQuantity: "asc" },
        // A ceiling rather than a page: the screen holds the rules and pages
        // them in the browser, and the checkout needs all of them at once to
        // find the most aggressive one that applies. An operator writes these
        // by hand, so five hundred is a number nobody reaches - and if one
        // did, a truncated answer beats an unbounded read.
        take: 500,
    });
    return NextResponse.json({ discounts });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = bulkDiscountSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }

    const { name, minQuantity, discountPercent, productId, categoryId } = validation.data;

    const discount = await prisma.bulkDiscount.create({
        data: {
            name,
            minQuantity,
            discountPercent,
            productId: productId || null,
            categoryId: categoryId || null,
        },
    });
    return NextResponse.json({ discount }, { status: 201 });
}
