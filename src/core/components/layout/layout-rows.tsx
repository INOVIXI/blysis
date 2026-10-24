import React from "react";
import type { ResolvedInstance } from "@/core/lib/page-layout";
import type { RowSplit } from "@/core/lib/page-layout-schema";

/**
 * The grid each split other than two thirds and one third is drawn in, for
 * the homepage and for a module's page alike. The two thirds and one third
 * row is each page's sidebar layout, which its view draws itself.
 */
export const LAYOUT_GRID: Record<Exclude<RowSplit, "2-1">, { row: string; cells: string[] }> = {
    "full": { row: "grid grid-cols-1", cells: [""] },
    "1": { row: "grid grid-cols-1", cells: [""] },
    "1-1": { row: "grid grid-cols-1 lg:grid-cols-2 gap-6", cells: ["", ""] },
    "1-2": { row: "grid grid-cols-1 lg:grid-cols-3 gap-6", cells: ["", "lg:col-span-2"] },
    "1-1-1": { row: "grid grid-cols-1 lg:grid-cols-3 gap-6", cells: ["", "", ""] },
    "1-2-1": { row: "grid grid-cols-1 lg:grid-cols-4 gap-6", cells: ["", "lg:col-span-2", ""] },
    "1-1-1-1": { row: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6", cells: ["", "", "", ""] },
};

/**
 * One block in a box that names it, its variant and its width, so a theme
 * styles it by attribute, and that is an inline-size container, so the
 * block lays itself out by the width it was given rather than the screen's.
 * A block with nothing to show renders nothing and its box is `:empty`.
 */
export function BlockBox({ instance, children }: { instance: ResolvedInstance; children: React.ReactNode }) {
    const variant = typeof instance.settings.variant === "string" ? instance.settings.variant : undefined;
    return (
        <div data-block={instance.block.id} data-variant={variant} data-width={instance.width} className="@container">
            {children}
        </div>
    );
}
