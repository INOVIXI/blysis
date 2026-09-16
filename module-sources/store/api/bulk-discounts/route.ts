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
    const discounts = await prisma.bulkDiscount.findMany({
        where: { isActive: true },
        orderBy: { minQuantity: "asc" },
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
