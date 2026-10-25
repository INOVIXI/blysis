import React from "react";
import { PageFrame, type PageFrameProps } from "@/core/components/layout/PageFrame";
import { PageRows, type BlockDrawers } from "@/core/components/layout/arranged-rows";
import { loadPageLayout } from "@/core/lib/page-layout-loader";
import { log } from "@/core/lib/logger";

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
    blocks: BlockDrawers;
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
export async function ArrangedPage({ page, frame, blocks, children, sidebar = true }: ArrangedPageProps) {
    const layout = await loadPageLayout(page);
    if (!layout) log.error(`page "${page}" is not one any installed module declares, so none of its blocks is drawn`);
    return (
        <PageFrame {...frame} header={layout?.header ?? "shown"}>
            {children}
            <PageRows rows={layout?.rows ?? []} draw={blocks} sidebar={sidebar} />
        </PageFrame>
    );
}
