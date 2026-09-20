/**
 * One table, ready to draw, however it was asked for.
 *
 * Two doors lead here - a table's own page asks by slug, a shelf drawn as a
 * comparison asks by subject - and they have to answer with the same thing.
 * Two readers would drift, and the half that drifts is always the one nobody
 * opened this week.
 *
 * A table with a subject has its columns brought into line with that subject
 * first, so a product added to a shelf is a column before anybody edits
 * anything. That write happens on a read, which is unusual and deliberate:
 * the alternative is an operator opening the editor to find the shelf and the
 * table disagreeing, and having to press a button to make them agree.
 */

import { prisma } from "@/core/sdk/server";
import { buildGrid, type GridGroup } from "./grid";
import { reconcileColumns } from "./subject-columns";

export interface DrawnColumn {
    id: string;
    label: string;
    subtitle: string | null;
    href: string | null;
    highlight: boolean;
    /** Everything the owning module says about it, when it owns one. */
    image: string | null;
    /** What this reader pays. */
    price: number | null;
    /** The list price, when it is on sale. */
    was: number | null;
    /** What somebody with no history pays. Differs only on a personal offer. */
    fullPrice: number | null;
    note: string | null;
    buyHref: string | null;
}

export interface DrawnTable {
    slug: string;
    title: string;
    description: string | null;
    subjectRef: string | null;
    columns: DrawnColumn[];
    groups: GridGroup[];
}

/** By its own address, or by what it is about. Exactly one of the two. */
export async function readTable(by: { slug?: string; subject?: string; locale?: string }): Promise<DrawnTable | null> {
    const where = by.slug
        ? { slug: by.slug, isActive: true }
        : by.subject
            ? { subjectRef: by.subject, isActive: true }
            : null;
    if (!where) return null;

    const table = await prisma.comparisonTable.findFirst({
        where,
        include: {
            columns: { orderBy: { order: "asc" } },
            groups: { orderBy: { order: "asc" } },
            rows: { orderBy: { order: "asc" }, include: { cells: true } },
        },
    });
    if (!table) return null;

    // Columns from the subject where there is one, and the stored columns
    // otherwise. A subject that answers with nothing - its module turned off,
    // its shelf emptied - falls back to whatever is stored, so the table reads
    // the way it did rather than becoming a heading over nothing.
    const reconciled = table.subjectRef ? await reconcileColumns(table.id, table.subjectRef, by.locale) : [];
    const live = new Map(reconciled.map((column) => [column.id, column]));

    const drawn: DrawnColumn[] = (reconciled.length > 0
        ? reconciled.map((column) => column.id)
        : table.columns.map((column) => column.id)
    ).map((id) => {
        const stored = table.columns.find((column) => column.id === id);
        const fresh = live.get(id);
        const source = fresh?.source ?? null;
        return {
            id,
            label: source?.label ?? stored?.label ?? "",
            subtitle: source?.subtitle ?? stored?.subtitle ?? null,
            href: source?.href ?? stored?.href ?? null,
            highlight: source?.highlight ?? stored?.highlight ?? false,
            image: source?.image ?? null,
            price: source?.price ?? null,
            was: source?.was ?? null,
            fullPrice: source?.fullPrice ?? source?.price ?? null,
            note: source?.note ?? null,
            buyHref: source?.buyHref ?? null,
        };
    });

    const grid = buildGrid(
        drawn.map((column, order) => ({ id: column.id, label: column.label, order })),
        table.groups.map((group) => ({ id: group.id, label: group.label, order: group.order })),
        table.rows.map((row) => ({ id: row.id, groupId: row.groupId, label: row.label, order: row.order })),
        table.rows.flatMap((row) =>
            row.cells.map((cell) => ({
                rowId: cell.rowId,
                columnId: cell.columnId,
                kind: cell.kind as "yes" | "no" | "value",
                value: cell.value,
            })),
        ),
    );

    return {
        slug: table.slug,
        title: table.title,
        description: table.description,
        subjectRef: table.subjectRef,
        columns: drawn,
        groups: grid.groups,
    };
}
