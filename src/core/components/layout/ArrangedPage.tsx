import React from "react";
import SidebarLayout from "@/core/components/layout/SidebarLayout";
import { PageFrame, type PageFrameProps } from "@/core/components/layout/PageFrame";
import { BlockBox, LAYOUT_GRID } from "@/core/components/layout/layout-rows";
import { ModuleErrorBoundary } from "@/core/components/ModuleErrorBoundary";
import { loadPageLayout } from "@/core/lib/page-layout-loader";
import { log } from "@/core/lib/logger";
import type { BlockProps } from "@/core/lib/page-blocks";
import type { ResolvedInstance, ResolvedRow } from "@/core/lib/page-layout";
import type { RowSplit } from "@/core/lib/page-layout-schema";

export interface ArrangedPageProps {
    /** `<module>.<page>`, as the module's manifest declares the page. */
    page: string;
    /** What names the page, as `PageFrame` takes it. */
    frame: Omit<PageFrameProps, "children" | "sidebar" | "header">;
    /**
     * How each block the manifest declares for the page is drawn, by its id
     * there. Called only for a block the arrangement places, with the
     * settings it gave and the width of the cell it stands in.
     */
    blocks: Record<string, (props: BlockProps) => React.ReactNode>;
    /** Drawn before the rows and outside them: structured data, for one. */
    children?: React.ReactNode;
    /**
     * Whether the page's third beside two thirds is its sidebar, drawn as
     * every page's sidebar is and styled by themes as one. `false` for a page
     * whose two columns are its own, as a product and the box it is bought
     * from are: they then stand in a grid of the page's.
     */
    sidebar?: boolean;
}

type Draw = ArrangedPageProps["blocks"];

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

function Block({ instance, draw }: { instance: ResolvedInstance; draw: Draw }) {
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

function Row({ row, draw, sidebar }: { row: ResolvedRow; draw: Draw; sidebar: boolean }) {
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
 * A module's page, arranged from the blocks it declares: the active theme's
 * arrangement for it, else the module's own, inside the frame every page is
 * drawn in.
 *
 * The page reads what it shows once and hands each block a function that
 * draws it, so a block is the module's own markup and may be a server
 * component; core only decides where it stands. A theme may also hide the
 * header band, and the title is then the page's unseen h1.
 *
 * The rows are held in one box that draws nothing of its own, which
 * `globals.css` gives a page's closer spacing: the parts of one page stand as
 * its blocks do, not as the homepage's sections.
 */
export async function ArrangedPage({ page, frame, blocks, children, sidebar = true }: ArrangedPageProps) {
    const layout = await loadPageLayout(page);
    if (!layout) log.error(`page "${page}" is not one any installed module declares, so none of its blocks is drawn`);
    return (
        <PageFrame {...frame} header={layout?.header ?? "shown"}>
            {children}
            <div data-page-rows>
                {(layout?.rows ?? []).map((row, r) => <Row key={r} row={row} draw={blocks} sidebar={sidebar} />)}
            </div>
        </PageFrame>
    );
}
