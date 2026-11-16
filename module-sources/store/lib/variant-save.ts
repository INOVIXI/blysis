/**
 * Writing a product's variants as the operator left them on the form.
 *
 * Two things the form cannot do for itself. It cannot make an id on a site
 * served over plain http, where a browser has no `crypto.randomUUID`, so a
 * new variant gets one here. And taking a variant off the form is not the
 * same as taking it out of the shop's history: one that was ever ordered
 * stays in the list, switched off, so a buyer's basket line and an order
 * screen still find the name it was bought under.
 */
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/sdk/server";
import { variantsOf, type ProductVariant } from "./variants";
import type { productVariantSchema } from "./validations";
import type { z } from "zod";

type VariantInput = z.infer<typeof productVariantSchema>;

/** Whether any order line was bought as this variant of this product. */
async function wasOrdered(productId: string, variantId: string): Promise<boolean> {
    const line = await prisma.orderItem.findFirst({
        where: { productId, metadata: { path: ["variant", "id"], equals: variantId } },
        select: { id: true },
    });
    return line !== null;
}

/**
 * The JSON the variants column takes, from what the form sent.
 *
 * `productId` is null for a product being created, which has no orders and
 * nothing to keep.
 */
export async function variantsToSave(
    productId: string | null,
    input: VariantInput[],
    stored: unknown,
): Promise<Prisma.InputJsonValue> {
    const sent: ProductVariant[] = input.map((entry) => ({
        id: entry.id && entry.id.trim() !== "" ? entry.id : randomUUID(),
        label: typeof entry.label === "string" ? entry.label : { ...entry.label, default: entry.label.default ?? "" },
        price: Math.round(entry.price * 100) / 100,
        units: entry.units ?? 1,
        durationDays: entry.durationDays ?? null,
        variables: entry.variables ?? {},
        commands: (entry.commands ?? []).map((command) => ({
            command: command.command,
            serverId: command.serverId ?? null,
            target: command.target ?? null,
            whenOnline: command.whenOnline ?? null,
        })),
        isActive: entry.isActive !== false,
    }));

    const kept = new Set(sent.map((variant) => variant.id));
    const dropped = productId ? variantsOf(stored).filter((variant) => !kept.has(variant.id)) : [];
    for (const variant of dropped) {
        if (await wasOrdered(productId as string, variant.id)) sent.push({ ...variant, isActive: false });
    }
    return sent as unknown as Prisma.InputJsonValue;
}
