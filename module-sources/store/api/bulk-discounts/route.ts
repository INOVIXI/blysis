import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";

const bulkDiscountSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    minQuantity: z.number().int().min(1, "Min quantity must be at least 1"),
    discountPercent: z.number().min(0, "Discount cannot be negative").max(100, "Discount cannot exceed 100%"),
    /**
     * Where the rule applies. Empty is every product, which is what every
     * rule written before there was a way to say otherwise meant. Capped
     * because this arrives from a form and lands in an array column.
     */
    productIds: z.array(z.string().min(1).max(64)).max(200).optional(),
    categoryIds: z.array(z.string().min(1).max(64)).max(200).optional(),
    /**
     * The form has always drawn this switch and the create never read it, so
     * a rule written switched off arrived switched on.
     */
    isActive: z.boolean().optional(),
});

export async function GET() {
    /*
     * Every rule, not only the live ones.
     *
     * This filtered on `isActive` while the screen behind it offers a switch
     * for exactly that column: turning a discount off made its row vanish
     * from the only screen that could turn it back on. Whoever reads the
     * rules decides which of them apply - the till asks for the live ones,
     * and the ladder a shopper is shown skips a rule that is switched off.
     *
     * No join for the products or the categories: the two lists hold plain
     * strings, not foreign keys, so there is no relation to include and
     * nothing stops a rule naming a product that has been deleted. An id left
     * behind simply narrows the rule to nothing, which is the behaviour a
     * delete should have.
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

    const { name, minQuantity, discountPercent, productIds, categoryIds, isActive } = validation.data;

    const discount = await prisma.bulkDiscount.create({
        data: {
            name,
            minQuantity,
            discountPercent,
            productIds: productIds ?? [],
            categoryIds: categoryIds ?? [],
            isActive: isActive ?? true,
        },
    });
    return NextResponse.json({ discount }, { status: 201 });
}
