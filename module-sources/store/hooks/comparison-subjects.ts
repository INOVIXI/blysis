/**
 * Answers `comparison.subjects`: the shelves a comparison can be built about.
 *
 * Every active category, whether or not it is currently drawn as a table -
 * the operator has to be able to pick one before switching it over, and a
 * picker that only offers what is already switched on is a picker nobody can
 * get started with.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";
import { CATEGORY_SUBJECT } from "../lib/comparison-subject";

const subjects: HookHandlerFor<"comparison.subjects", "filter"> = async (current) => {
    const categories = await prisma.category.findMany({
        where: { isActive: true },
        orderBy: { order: "asc" },
        take: 300,
        select: { id: true, name: true, parent: { select: { name: true } } },
    });

    return [
        ...current,
        ...categories.map((category) => ({
            ref: `${CATEGORY_SUBJECT}:${category.id}`,
            // The parent in the name, because "Keys" under "Ranks" and "Keys"
            // on its own are two shelves and a flat list cannot tell them apart.
            label: category.parent ? `${category.parent.name} / ${category.name}` : category.name,
            group: "store",
        })),
    ];
};

export default subjects;
