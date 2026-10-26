"use client";

import React from "react";
import { BlockComponentRegistry } from "@/core/generated/module-components";
import { CORE_BLOCK_COMPONENTS } from "@/core/components/blocks";
import { ModuleErrorBoundary } from "@/core/components/ModuleErrorBoundary";
import StandardSidebarLayout from "@/core/components/layout/SidebarLayout";
import type { ResolvedInstance, ResolvedLayout, ResolvedRow } from "@/core/lib/page-layout";
import { cellWidths } from "@/core/lib/page-layout-schema";
import { BlockBox, LAYOUT_GRID } from "@/core/components/layout/layout-rows";

interface PageLayoutViewProps {
    layout: ResolvedLayout;
    /** What a site with no content shows in its main column. */
    welcome: React.ReactNode;
}

function Block({ instance }: { instance: ResolvedInstance }) {
    const Component = CORE_BLOCK_COMPONENTS[instance.block.id] ?? BlockComponentRegistry[instance.block.id];
    if (!Component) return null;
    return (
        <BlockBox instance={instance}>
            <ModuleErrorBoundary componentId={instance.block.id}>
                <Component settings={instance.settings} width={instance.width} />
            </ModuleErrorBoundary>
        </BlockBox>
    );
}

function Row({ row, welcomeAt, welcome }: { row: ResolvedRow; welcomeAt: number; welcome: React.ReactNode }) {
    // A gap, not `space-y`: a block that drew nothing is still a child, and
    // `space-y` left a margin under the last block that did
    // (a-column-ends-where-its-last-card-does).
    const cell = (index: number) => (index === welcomeAt ? welcome : (
        <div data-layout-blocks className="flex flex-col gap-8">
            {row.cells[index].map((instance) => <Block key={instance.key} instance={instance} />)}
        </div>
    ));

    if (row.split === "2-1") {
        // Today's page, hook for hook: the spacer answers the heading every
        // section in the main column opens with, and a row with nothing beside
        // the main column is the main column alone, as it always was.
        const side = row.cells[1];
        if (side.length === 0) return cell(0);
        return (
            <StandardSidebarLayout
                sidebar={
                    <>
                        <div aria-hidden="true" className="hidden lg:block blysis-heading-spacer" />
                        {side.map((instance) => <Block key={instance.key} instance={instance} />)}
                    </>
                }
            >
                {cell(0)}
            </StandardSidebarLayout>
        );
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

/** The first cell that is not narrow, where the welcome card stands. */
function welcomeCell(rows: ResolvedRow[]): { row: number; cell: number } | null {
    for (let row = 0; row < rows.length; row++) {
        const cell = cellWidths(rows[row].split).findIndex((width) => width !== "narrow");
        if (cell >= 0) return { row, cell };
    }
    return null;
}

/**
 * The page's arrangement, row after row. The rows are not wrapped in an
 * element of their own: a theme that reaches the two thirds and one third
 * row as a direct child of its frame still finds it. The
 * space between rows is `globals.css`'s. A `full` row spans the page column;
 * running it from edge to edge is the theme's to do, by `data-layout-row`.
 *
 * The welcome card takes the first wide or full cell when the page has no
 * content, as it took the main column before; a page with no such cell shows
 * it above the rows.
 */
export function PageLayoutView({ layout, welcome }: PageLayoutViewProps) {
    const target = layout.welcome ? welcomeCell(layout.rows) : null;
    return (
        <>
            {layout.welcome && !target ? welcome : null}
            {layout.rows.map((row, r) => (
                <Row key={r} row={row} welcome={welcome} welcomeAt={target && target.row === r ? target.cell : -1} />
            ))}
        </>
    );
}
