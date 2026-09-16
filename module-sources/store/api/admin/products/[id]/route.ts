/**
 * One product as an operator needs to see it.
 *
 * The public endpoint at /api/v1/store/products/[id] publishes a named set of
 * columns and only products that are on sale, which is what lets a proxy hold
 * its answer. The edit screen needs the opposite of both: every column the
 * form has a field for, and above all the product that was just switched off,
 * since that is the one an operator opens.
 *
 * Those are two different questions, so they are two endpoints - the same split
 * the listing already makes. Keeping them in one meant the public route had to
 * look up a session to decide what to say, on the page every visitor asks for.
 */
import { NextRequest, NextResponse } from "next/server";
import { hasPermission, log, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

type RouteParams = { params: Promise<{ id: string }> };

/** This answer depends on who asked, so nothing may keep a copy of it. */
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
    }
    if (!(await hasPermission(session.user.id, "store.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE });
    }

    try {
        const { id } = await params;
        // The same three ways in the public route accepts, so a link an
        // operator followed from one screen works on the other.
        const product = await prisma.product.findFirst({
            where: {
                OR: [
                    { id },
                    { slug: id },
                    ...(isNaN(Number(id)) ? [] : [{ number: Number(id) }]),
                ],
            },
            include: { category: { select: { id: true, name: true, slug: true } } },
        });

        if (!product) {
            return NextResponse.json({ error: "Product not found" }, { status: 404, headers: PRIVATE });
        }

        return NextResponse.json({ product }, { headers: PRIVATE });
    } catch (error) {
        log.error("Read a product for an operator failed", {
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: PRIVATE });
    }
}
