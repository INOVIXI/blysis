import { applyFiltersAsync } from "@/core/sdk";
import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * The table a shop puts next to its ranks - and, where there is a shop, the
 * shelf itself drawn as one.
 *
 * It used to be three typed columns called Free, VIP and Gold while the shop
 * sold VIP, VIP+, MVP, MVP+ and Legend, which is the exact failure the subject
 * binding exists to end: a table with no connection to the catalogue drifts
 * from it the day either one is edited, and nobody notices because both look
 * right on their own.
 *
 * So the seeded table is about the Ranks shelf, and its columns are that
 * shelf's own products with live names and prices - asked for through the
 * hooks, which is also how the page asks. The rows below are the operator's
 * half, the part no catalogue can answer, written against the ladder as it is
 * sold, cheapest first.
 *
 * Switching that shelf over to be drawn as a table is the shop's own seed's
 * job: the category is the shop's row, and a module reaching into another
 * module's table to flip a column is the thing `a-module-owns-what-it-reads`
 * exists to catch.
 *
 * With no shop installed it falls back to the typed columns it always had,
 * because a comparison of hosting plans on a site with nothing for sale is
 * still the thing this module is for.
 */

/** The shelf this is about, when the site has one. */
const SUBJECT_CATEGORY = "Ranks";

/** Columns for a site with no shop. Same shape, typed by hand. */
const TYPED_COLUMNS: { label: string; subtitle: string; highlight?: true }[] = [
    { label: "Free", subtitle: "Everyone who joins" },
    { label: "VIP", subtitle: "A few a month", highlight: true },
    { label: "Gold", subtitle: "The long-haul one" },
];

type Cell = { kind: "yes" | "no" | "value" | "unstated"; value?: string };
const YES: Cell = { kind: "yes" };
const NO: Cell = { kind: "no" };
const UNSTATED: Cell = { kind: "unstated" };
const value = (v: string): Cell => ({ kind: "value", value: v });

/**
 * A feature, and what it is worth at each step up the ladder.
 *
 * Written for five columns, cheapest first, and trimmed or padded to whatever
 * the shelf actually holds: a seed that assumes the catalogue is a seed that
 * breaks the first time somebody adds a rank.
 */
const GROUPS: { label: string; rows: { label: string; cells: Cell[] }[] }[] = [
    {
        label: "On the server",
        rows: [
            { label: "Homes you can set", cells: [value("3"), value("5"), value("10"), value("15"), value("25")] },
            { label: "Queue priority", cells: [NO, YES, YES, YES, YES] },
            { label: "Coloured name in chat", cells: [NO, YES, YES, YES, YES] },
            { label: "/fly in the lobby", cells: [NO, NO, YES, YES, YES] },
            { label: "Starting money", cells: [value("10K"), value("20K"), value("50K"), value("100K"), value("250K")] },
        ],
    },
    {
        label: "On the site",
        rows: [
            { label: "Forum signature", cells: [NO, YES, YES, YES, YES] },
            { label: "Badge beside your name", cells: [NO, YES, YES, YES, YES] },
            { label: "Early access to events", cells: [NO, NO, UNSTATED, YES, YES] },
            { label: "Support reply time", cells: [value("When we can"), value("2 days"), value("2 days"), value("Same day"), value("Same day")] },
        ],
    },
];

interface PlannedColumn {
    label: string;
    subtitle: string | null;
    sourceRef: string | null;
    highlight: boolean;
}

/**
 * The shelf's own products, asked for the way the page asks for them.
 *
 * Through the hooks, not through the shop's tables. A seed that reached into
 * `Product` would be this module learning what a product is - the one thing
 * the whole design is built to avoid - and it would also prove nothing: the
 * page uses the seam, so the seed should fail where the page would.
 */
async function shelfColumns(): Promise<{ subjectRef: string; columns: PlannedColumn[] } | null> {
    const subjects = await applyFiltersAsync("comparison.subjects", [], {});
    const shelf = subjects.find((subject) => subject.label === SUBJECT_CATEGORY);
    if (!shelf) return null;

    const columns = await applyFiltersAsync("comparison.columns", [], { subjectRef: shelf.ref });
    if (columns.length === 0) return null;

    return {
        subjectRef: shelf.ref,
        columns: columns.map((column) => ({
            label: column.label,
            subtitle: column.subtitle ?? null,
            sourceRef: column.ref,
            highlight: column.highlight === true,
        })),
    };
}

export const seed: ModuleSeed = {
    needs: ["store"],
    run: async (ctx) => {
        const slug = "ranks";
        const existing = await ctx.prisma.comparisonTable.findFirst({ where: { slug } });
        if (existing) { ctx.log("already there"); return; }

        const shelf = await shelfColumns();
        const planned: PlannedColumn[] = shelf?.columns ?? TYPED_COLUMNS.map((column) => ({
            label: column.label,
            subtitle: column.subtitle,
            sourceRef: null,
            highlight: column.highlight === true,
        }));

        const table = await ctx.create("comparisonTable", () => ctx.prisma.comparisonTable.create({
            data: {
                slug,
                title: "What each rank gets you",
                description: "Everything below is per account, not per character.",
                subjectRef: shelf?.subjectRef ?? null,
                createdAt: ctx.daysAgo(200),
            },
        }));

        const columns: { id: string }[] = [];
        for (const [order, column] of planned.entries()) {
            columns.push(await ctx.create("comparisonColumn", () => ctx.prisma.comparisonColumn.create({
                data: {
                    tableId: table.id,
                    label: column.label,
                    subtitle: column.subtitle,
                    sourceRef: column.sourceRef,
                    highlight: column.highlight,
                    order,
                },
            })));
        }

        let rowOrder = 0;
        for (const [groupOrder, group] of GROUPS.entries()) {
            const created = await ctx.create("comparisonGroup", () => ctx.prisma.comparisonGroup.create({
                data: { tableId: table.id, label: group.label, order: groupOrder },
            }));

            for (const row of group.rows) {
                const createdRow = await ctx.create("comparisonRow", () => ctx.prisma.comparisonRow.create({
                    data: { tableId: table.id, groupId: created.id, label: row.label, order: rowOrder++ },
                }));

                // One cell per column the table actually has. A row written for
                // five and drawn against three keeps its first three answers
                // rather than failing: the rows are prose about a ladder, and a
                // ladder with fewer steps is still that ladder.
                for (const [index, column] of columns.entries()) {
                    const cell = row.cells[index] ?? UNSTATED;
                    // An unstated cell is skipped, not stored. A stored one is
                    // a claim, and "nobody said" is the absence of a claim.
                    if (cell.kind === "unstated") continue;
                    await ctx.create("comparisonCell", () => ctx.prisma.comparisonCell.create({
                        data: {
                            rowId: createdRow.id,
                            columnId: column.id,
                            kind: cell.kind,
                            value: cell.value ?? null,
                        },
                    }));
                }
            }
        }

        ctx.log(
            `1 table, ${columns.length} columns${shelf ? " from the Ranks shelf" : " typed"}, ` +
            `${GROUPS.reduce((n, g) => n + g.rows.length, 0)} rows`,
        );
    },
};
