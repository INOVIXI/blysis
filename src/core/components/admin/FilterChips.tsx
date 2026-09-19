"use client";

import * as React from "react";
import { buttonClassName } from "@/core/components/ui/button";
import { cn } from "@/core/lib/utils";

/**
 * The strip of chips that narrows a list to one named kind.
 *
 * Not a tab rail. `a-tab-rail-is-operable-by-keyboard` drew that line and left
 * a note about this: switching between lists is a tablist with arrow keys,
 * narrowing one list by one dimension is "a third thing, and they deserve
 * their own shared component". This is that component. A chip is a toggle -
 * `aria-pressed`, one tab stop each - so a reader is told it narrows rather
 * than that it switches views.
 *
 * Three screens drew one and all three drew it differently. The moderation
 * queue wrote raw buttons with its own colours and set the count in a
 * ten-pixel span pressed against the label, so "Blog Yorumları14" ran
 * together; a kind with nothing waiting got no count at all, so that tab was
 * visibly shorter than the ones beside it. The store's orders screen put its
 * count in brackets, also only when it was not zero, so its tabs changed
 * width as orders arrived. The ticket queue had no counts and four cards
 * above doing that job instead.
 *
 * Two decisions worth writing down.
 *
 * A count of zero is shown. Dropping it is what made the strip look out of
 * proportion, and it takes information away at the same time: an operator
 * cannot tell "nothing is waiting here" from "this screen does not count
 * that". `tabular-nums` so a tab does not jiggle as its number changes width.
 *
 * A reader who cannot see which chip is filled is told by `aria-pressed`,
 * which is what a toggle says. The row itself is a `group` with a name, so
 * that reader learns what the chips narrow by before pressing one.
 */

export interface FilterChip {
    id: string;
    label: string;
    /** Left out where a screen has no number to give. */
    count?: number;
}

export interface FilterChipsProps {
    chips: readonly FilterChip[];
    active: string;
    onSelect: (id: string) => void;
    /** What the strip narrows by, for a screen reader. */
    label: string;
    className?: string;
}

export function FilterChips({ chips, active, onSelect, label, className }: FilterChipsProps) {
    return (
        <div role="group" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
            {chips.map((tab) => {
                const chosen = tab.id === active;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        aria-pressed={chosen}
                        onClick={() => onSelect(tab.id)}
                        className={buttonClassName(chosen ? "default" : "outline", "sm")}
                    >
                        <span>{tab.label}</span>
                        {tab.count !== undefined && (
                            <span
                                className={cn(
                                    "rounded-full px-1.5 py-0.5 text-xs leading-none tabular-nums",
                                    chosen ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                                )}
                            >
                                {tab.count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
