import React from "react";
import SidebarLayout from "@/core/components/layout/SidebarLayout";
import { BlockBox, LAYOUT_GRID } from "@/core/components/layout/layout-rows";
import { ModuleErrorBoundary } from "@/core/components/ModuleErrorBoundary";
import type { BlockProps } from "@/core/lib/page-blocks";
import type { ResolvedInstance, ResolvedRow } from "@/core/lib/page-layout";
import type { RowSplit } from "@/core/lib/page-layout-schema";

/** How each block a page declares is drawn, by its id in the manifest. */
export type BlockDrawers = Record<string, (props: BlockProps) => React.ReactNode>;

/**
 * The homepage's grids, but for a page's two halves, which sit side by side
 * from a tablet up, as a member's profile drew its two cards before it was
 * arranged, so a site whose theme keeps the module's arrangement sees it so;
 * and two thirds and a third for a page with no sidebar.
 */
const PAGE_GRID: Record<RowSplit, { row: string; cells: string[] }> = {
    ...LAYOUT_GRID,
    "1-1": { row: "grid grid-cols-1 md:grid-cols-2 gap-6", cells: ["", ""] },
    // Two columns of the page's own, at the spacing a product always had.
    "2-1": { row: "grid grid-cols-1 lg:grid-cols-3 gap-8", cells: ["lg:col-span-2", ""] },
};

function Block({ instance, draw }: { instance: ResolvedInstance; draw: BlockDrawers }) {
    const render = draw[instance.block.entryId];
    if (!render) return null;
    return (
        <BlockBox instance={instance}>
            <ModuleErrorBoundary componentId={instance.block.id}>
                {render({ settings: instance.settings, width: instance.width })}
            </ModuleErrorBoundary>
        </BlockBox>
    );
}

function Row({ row, draw, sidebar }: { row: ResolvedRow; draw: BlockDrawers; sidebar: boolean }) {
    const blocks = (index: number) => row.cells[index].map((instance) => <Block key={instance.key} instance={instance} draw={draw} />);
    // A block alone in its cell fills it, so two cards side by side end on
    // one line, as they did when a page set them in a grid of its own.
    const cell = (index: number) => (
        <div data-layout-blocks className="flex flex-col gap-6 h-full [&>[data-block]:only-child]:flex-1">{blocks(index)}</div>
    );

    if (row.split === "2-1" && sidebar) {
        // The sidebar every page drew through `PageFrame`, hook for hook, so
        // a page that stands as it did is drawn as it was.
        if (row.cells[1].length === 0) return <div data-layout-row="1">{cell(0)}</div>;
        return <SidebarLayout sidebar={blocks(1)}>{cell(0)}</SidebarLayout>;
    }

    const grid = PAGE_GRID[row.split];
    return (
        <div data-layout-row={row.split} className={grid.row}>
            {row.cells.map((_, index) => (
                <div key={index} data-layout-cell className={`min-w-0 ${grid.cells[index]}`.trim()}>
                    {cell(index)}
                </div>
            ))}
        </div>
    );
}

/**
 * A page's rows, for a page drawn on the server and one drawn in the browser
 * alike, so the two kinds of page stand the same under the same arrangement.
 *
 * The rows are held in one box that draws nothing of its own, which
 * `globals.css` gives a page's closer spacing: the parts of one page stand as
 * its blocks do, not as the homepage's sections.
 *
 * Only the blocks the page was handed a way to draw stand, and a row left
 * with none is not drawn: a page that is still reading what it shows passes
 * no blocks and says it is waiting, and that is all it shows.
 */
export function PageRows({ rows, draw, sidebar }: { rows: ResolvedRow[]; draw: BlockDrawers; sidebar: boolean }) {
    const drawn = rows
        .map((row) => ({ ...row, cells: row.cells.map((cell) => cell.filter((i) => draw[i.block.entryId])) }))
        .filter((row) => row.cells.some((cell) => cell.length > 0));
    return (
        <div data-page-rows>
            {drawn.map((row, r) => <Row key={r} row={row} draw={draw} sidebar={sidebar} />)}
        </div>
    );
}
