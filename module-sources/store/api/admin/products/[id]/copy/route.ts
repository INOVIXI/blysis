import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { hasPermission, log, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { copyOf, freeSlug } from "../../../../../lib/clone-product";
import { copyProductSchema } from "../../../../../lib/validations";

/**
 * POST /api/v1/store/admin/products/[id]/copy - one product, again.
 *
 * A shop that sells four tiers of the same thing builds the first one
 * carefully and then needs three more of it at three prices. Typing it out
 * again is where the fourth loses a delivery command nobody notices until
 * somebody pays for it.
 *
 * What is copied and what is left behind is decided in `clone-product.ts`.
 * What this route adds is the rows that live in their own tables: the
 * delivery commands and the buyer's fields. They are the reason the copy is
 * one transaction - a product row written with no commands beside it is
 * exactly the half-made product this exists to prevent.
 */

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = copyProductSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const original = await prisma.product.findUnique({ where: { id } });
    if (!original) return NextResponse.json({ error: "That product no longer exists" }, { status: 404 });

    // Every slug that starts the same way, so the copy can count past them
    // all rather than fill the first gap somebody's deletion left.
    const nearby = await prisma.product.findMany({
        where: { slug: { startsWith: `${original.slug}-copy` } },
        select: { slug: true },
        take: 200,
    });

    const [commands, variables] = await Promise.all([
        prisma.productCommand.findMany({ where: { productId: id }, orderBy: { order: "asc" } }),
        prisma.productVariable.findMany({ where: { productId: id } }),
    ]);

    try {
        const copy = await prisma.$transaction(async (tx) => {
            const copied = copyOf(original, {
                slug: freeSlug(original.slug, new Set(nearby.map((row) => row.slug))),
                // The caller names it, because a name is a row a visitor
                // reads and only the screen knows which language to say
                // "copy" in. Unnamed, it keeps the original's.
                name: parsed.data.name ?? original.name,
            });

            const written = await tx.product.create({
                data: {
                    ...copied,
                    // Prisma reads a JSON column as one type and writes it as
                    // another: what comes back as null goes in as JsonNull.
                    // The same narrowing the activity log does.
                    translations: (copied.translations ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                    deliveryData: (copied.deliveryData ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                },
            });

            if (commands.length > 0) {
                await tx.productCommand.createMany({
                    data: commands.map((row) => ({
                        productId: written.id,
                        command: row.command,
                        serverId: row.serverId,
                        order: row.order,
                    })),
                });
            }

            if (variables.length > 0) {
                await tx.productVariable.createMany({
                    data: variables.map((row) => ({
                        productId: written.id,
                        name: row.name,
                        label: row.label,
                        type: row.type,
                        required: row.required,
                        placeholder: row.placeholder,
                        options: row.options,
                    })),
                });
            }

            return written;
        });

        await logActivity({
            userId: session.user.id,
            action: "store.product.copied",
            entity: "product",
            entityId: copy.id,
            metadata: { from: id, slug: copy.slug },
        }).catch(() => {});

        return NextResponse.json({ product: copy }, { status: 201 });
    } catch (error) {
        log.error("Copy product failed", { id, error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: "That product could not be copied" }, { status: 500 });
    }
}
