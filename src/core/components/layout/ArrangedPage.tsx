import React from "react";
import SidebarLayout from "@/core/components/layout/SidebarLayout";
import { PageFrame, type PageFrameProps } from "@/core/components/layout/PageFrame";
import { BlockBox, LAYOUT_GRID } from "@/core/components/layout/layout-rows";
import { ModuleErrorBoundary } from "@/core/components/ModuleErrorBoundary";
import { loadPageLayout } from "@/core/lib/page-layout-loader";
import { log } from "@/core/lib/logger";
import type { BlockProps } from "@/core/lib/page-blocks";
import type { ResolvedInstance, ResolvedRow } from "@/core/lib/page-layout";

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
}

type Draw = ArrangedPageProps["blocks"];

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

function Row({ row, draw }: { row: ResolvedRow; draw: Draw }) {
    const blocks = (index: number) => row.cells[index].map((instance) => <Block key={instance.key} instance={instance} draw={draw} />);
    const cell = (index: number) => <div data-layout-blocks className="flex flex-col gap-6">{blocks(index)}</div>;

    if (row.split === "2-1") {
        // The sidebar every page drew through `PageFrame`, hook for hook, so
        // a page that stands as it did is drawn as it was.
        if (row.cells[1].length === 0) return <div data-layout-row="1">{cell(0)}</div>;
        return <SidebarLayout sidebar={blocks(1)}>{cell(0)}</SidebarLayout>;
    }

    const grid = LAYOUT_GRID[row.split];
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
 */
export async function ArrangedPage({ page, frame, blocks, children }: ArrangedPageProps) {
    const layout = await loadPageLayout(page);
    if (!layout) log.error(`page "${page}" is not one any installed module declares, so none of its blocks is drawn`);
    return (
        <PageFrame {...frame} header={layout?.header ?? "shown"}>
            {children}
            {(layout?.rows ?? []).map((row, r) => <Row key={r} row={row} draw={blocks} />)}
        </PageFrame>
    );
}
