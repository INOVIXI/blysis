"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/core/components/ui/checkbox";
import { cn } from "@/core/lib/utils";
import type { HeaderState } from "@/core/lib/bulk-selection";

/**
 * The strip above a list: how to tick the page, and what can be done to what
 * is ticked.
 *
 * The crud shell put its destructive button in the page header, next to "Add
 * new" - so an operator ticked three rows halfway down a table and the button
 * that would delete them was at the top of the screen, beside the one that
 * makes another. On a full page the button and the rows it names are never
 * visible at the same time, and the two buttons that sat together were the
 * two with the least in common.
 *
 * So the action sits here, with the rows. Nothing else on the screen changes
 * meaning when a row is ticked, and nothing else moves.
 *
 * The strip says one of two things and swaps between them: with nothing
 * ticked it explains how to tick the page, and with something ticked it says
 * how many and offers what can be done. The count is a promise about what is
 * on screen - `a-bulk-action-names-the-rows-it-will-touch.test.ts` holds the
 * arithmetic that keeps it true.
 */
export interface BulkBarProps {
    /** Whether none, some or all of the listed rows are ticked. */
    state: HeaderState;
    /** How many are ticked, which is always how many are listed and ticked. */
    count: number;
    onToggleAll: () => void;
    /** Buttons, shown only while something is ticked. */
    actions?: React.ReactNode;
    className?: string;
}

export function BulkBar({ state, count, onToggleAll, actions, className }: BulkBarProps) {
    const t = useTranslations("admin");

    return (
        <div
            role="group"
            aria-label={t("crud_bulkBar")}
            className={cn(
                "flex flex-wrap items-center gap-3 px-4 py-2 bg-muted/50 min-h-[2.75rem]",
                className,
            )}
        >
            {/* Two hundred rows and no select-all is two hundred clicks, and a
                box that reads "all" while some rows are unticked is a box that
                empties the selection on its next press. */}
            <Checkbox
                checked={state === "all"}
                indeterminate={state === "some"}
                onChange={onToggleAll}
                aria-label={t("crud_selectAll")}
            />
            <span className="text-sm text-muted-foreground">
                {count > 0 ? t("crud_selectedCount", { count }) : t("crud_selectAll")}
            </span>
            {count > 0 && actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
        </div>
    );
}
