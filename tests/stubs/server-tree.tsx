/**
 * Helpers for rendering a module's server page in a test.
 *
 * Testing Library renders client components; a server page is an async
 * function whose tree holds more async functions, its blocks and the parts
 * that read their own translations. `serverTree` resolves those, depth
 * first, into a tree Testing Library can render. A function component that
 * is not async is left for React to call.
 *
 * `arrangedPageStub` stands in for `ArrangedPage` the way the page meets it
 * on a site whose theme has no arrangement for it: the module's own default
 * from its manifest, resolved by the real resolver, under a frame that draws
 * the title as the h1. A test of the page therefore draws what a visitor to
 * such a site sees, hidden blocks left out. Given a theme's arrangements by
 * page, it draws a page the way that theme arranges it instead.
 * `arrangedClientPageStub` does the same for `ArrangedClientPage`.
 */
import React from "react";
import { pagesOf } from "@/core/lib/page-blocks";
import { resolvePageLayout } from "@/core/lib/page-layout";
import type { LayoutDocument } from "@/core/lib/page-layout-schema";
import type { ArrangedPageProps } from "@/core/components/layout/ArrangedPage";

const isAsync = (fn: unknown): fn is (props: unknown) => Promise<React.ReactNode> =>
    typeof fn === "function" && fn.constructor.name === "AsyncFunction";

export async function serverTree(node: React.ReactNode | Promise<React.ReactNode>): Promise<React.ReactNode> {
    const awaited = await node;
    if (Array.isArray(awaited)) {
        return Promise.all(awaited.map((child, index) => serverTree(child).then((resolved) =>
            React.isValidElement(resolved) && resolved.key === null ? React.cloneElement(resolved, { key: index }) : resolved)));
    }
    if (!React.isValidElement(awaited)) return awaited;
    const props = awaited.props as Record<string, unknown> & { children?: React.ReactNode };
    if (isAsync(awaited.type)) return serverTree(awaited.type(props));
    if (props.children === undefined) return awaited;
    return React.cloneElement(awaited, undefined, await serverTree(props.children));
}

function drawArranged(module: string, manifest: Parameters<typeof pagesOf>[1], themeLayouts: Record<string, LayoutDocument>, { page, frame, blocks, children }: ArrangedPageProps) {
    const declared = pagesOf(module, manifest).find((p) => p.id === page);
    if (!declared) throw new Error(`${module} declares no page ${page}`);
    const layout = resolvePageLayout({ page: declared, themeLayout: themeLayouts[page] });
    const drawn = layout.rows.flatMap((row) => row.cells.flat()).map((instance) => (
        <div key={instance.key} data-block={instance.block.id}>
            {blocks[instance.block.entryId]?.({ settings: instance.settings, width: instance.width })}
        </div>
    ));
    return <main><h1>{frame.title}</h1>{children}{drawn}</main>;
}

export function arrangedPageStub(module: string, manifest: Parameters<typeof pagesOf>[1], themeLayouts: Record<string, LayoutDocument> = {}) {
    return async function ArrangedPage(props: ArrangedPageProps) {
        return drawArranged(module, manifest, themeLayouts, props);
    };
}

/** `arrangedPageStub` for a page drawn in the browser, which `ArrangedClientPage` draws. */
export function arrangedClientPageStub(module: string, manifest: Parameters<typeof pagesOf>[1], themeLayouts: Record<string, LayoutDocument> = {}) {
    return function ArrangedClientPage(props: ArrangedPageProps) {
        return drawArranged(module, manifest, themeLayouts, props);
    };
}
