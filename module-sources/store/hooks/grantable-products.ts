/**
 * Answers `grantable.options`: what the shop will hand over on request.
 *
 * A module that gives prizes needs a list to offer an operator, and it must
 * not get that list by reading another module's table. It asks, and whoever
 * owns things answers with a name and an opaque id.
 *
 * Only what is on the shelf. A switched-off product is one an operator took
 * down, and offering it as a prize would put it back.
 *
 * Bounded, because this fills a picker: a shop with more products than this
 * is one where somebody is going to type a name rather than scroll, and the
 * picker searches what it was given.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

const MOST_OFFERED = 200;

const grantableProducts: HookHandlerFor<"grantable.options", "filter"> = async (current) => {
    const rows = await prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, name: true, category: { select: { name: true } } },
        orderBy: { name: "asc" },
        take: MOST_OFFERED,
    });

    return [
        ...current,
        ...rows.map((row) => ({
            id: row.id,
            label: row.name,
            // Which shelf it is from, so two products with similar names are
            // told apart without opening either.
            hint: row.category?.name ?? null,
        })),
    ];
};

export default grantableProducts;
