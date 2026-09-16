import { NextRequest, NextResponse } from "next/server";
import { isAdmin, log, moduleSettings, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { productSchema } from "../../../lib/validations";
import { availabilityData } from "../../../lib/availability-input";
import { PUBLIC_PRODUCT } from "../../../lib/public-product";
import { readProduct } from "../../../lib/read-product";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/v1/store/products/[id] - Get single product
//
// The read and the two rules about what a visitor may see live in
// lib/read-product.ts, because the page renders the product on the server now
// and the two must not disagree.
export async function GET(_request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        const product = await readProduct(id);
        if (!product) {
            return NextResponse.json({ error: "Product not found" }, { status: 404 });
        }
        return NextResponse.json({ product });
    } catch (error) {
        log.error("Get product error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// PATCH /api/v1/store/products/[id] - Update product (admin)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const adminCheck = await isAdmin(session.user.id);
        if (!adminCheck) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { id } = await params;
        const body = await readJsonBody(request);
        if (body instanceof NextResponse) return body;
        const validation = productSchema.partial().safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error.issues[0].message },
                { status: 400 }
            );
        }

        const existing = await prisma.product.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json({ error: "Product not found" }, { status: 404 });
        }

        const data = { ...validation.data };
        if (data.description !== undefined) {
            data.description = data.description;
        }

        // The schedule arrives as wall-clock strings; the column holds
        // instants. Splitting them out keeps the string fields off the update.
        const scheduled = await availabilityData(data, id);
        for (const key of Object.keys(scheduled)) {
            delete (data as Record<string, unknown>)[key];
        }

        const product = await prisma.product.update({
            where: { id },
            data: { ...data, ...scheduled },
            include: { category: true },
        });

        return NextResponse.json({ product });
    } catch (error) {
        log.error("Update product error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// DELETE /api/v1/store/products/[id] - Delete product (admin)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const adminCheck = await isAdmin(session.user.id);
        if (!adminCheck) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { id } = await params;

        const existing = await prisma.product.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json({ error: "Product not found" }, { status: 404 });
        }

        // Soft delete - set inactive instead of hard delete
        await prisma.product.update({ where: { id }, data: { isActive: false } });

        return NextResponse.json({ message: "Product archived" });
    } catch (error) {
        log.error("Delete product error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
