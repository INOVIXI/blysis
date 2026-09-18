"use client";

import * as React from "react";
import { NavIcon } from "@/core/components/ui/NavIcon";
import { cn } from "@/core/lib/utils";

/**
 * The rail above a list, for choosing which list.
 *
 * Two jobs had one shape. A member narrowing the punishment record by kind and
 * a member switching between leaderboards were both given a row of outline
 * buttons with the chosen one filled in, stacked two rows deep on the same
 * screen, and nothing said which row did what. Narrowing is the strip every
 * other list already has - a box and some selects, see `ListControls`.
 * Switching is this.
 *
 * Drawn as an underline rather than a segmented pill track, because the number
 * of tabs is not ours: a module adds a leaderboard, an operator adds a place,
 * and a pill track that looks deliberate with three looks broken with nine. An
 * underline rail degrades into a scroll.
 *
 * The keyboard is the part a hand-rolled row of buttons always misses. A
 * tablist is one tab stop and the arrows move inside it; a row of buttons
 * makes a reader press Tab nine times to reach the last board and a tenth to
 * leave. Only the selected tab is reachable by Tab, which is what
 * `tabIndex={-1}` on the rest is for, and moving the selection moves the
 * focus with it.
 */

export interface SegmentedTab {
    id: string;
    label: string;
    /** A lucide name, drawn only when the tab carries one. */
    icon?: string | null;
    /** Shown after the label. Absent and zero are not the same thing. */
    count?: number | null;
    /**
     * Anything else the tab has to say about itself - a lock on one that is
     * restricted, a price on one that costs something. Rendered after the
     * count, so a tab that carries both still reads left to right.
     */
    trailing?: React.ReactNode;
}

export interface SegmentedTabsProps {
    tabs: SegmentedTab[];
    activeId: string;
    onChange: (id: string) => void;
    /** Names the rail for a reader who arrives on it with nothing on screen to read. */
    label: string;
    className?: string;
}

export function SegmentedTabs({ tabs, activeId, onChange, label, className }: SegmentedTabsProps) {
    const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});

    const move = (event: React.KeyboardEvent, from: number) => {
        const last = tabs.length - 1;
        let to: number | null = null;
        if (event.key === "ArrowRight") to = from === last ? 0 : from + 1;
        else if (event.key === "ArrowLeft") to = from === 0 ? last : from - 1;
        else if (event.key === "Home") to = 0;
        else if (event.key === "End") to = last;
        if (to === null) return;

        event.preventDefault();
        const next = tabs[to];
        onChange(next.id);
        // The focus follows the selection, or the reader is left arrowing a
        // rail whose highlight has moved away from where their keyboard is.
        refs.current[next.id]?.focus();
    };

    return (
        <div
            role="tablist"
            aria-label={label}
            /*
             * Scrolls rather than wraps. A rail that wraps to a second line
             * puts half the choices below the fold of the thing they choose,
             * and the underline stops reading as one row.
             */
            /*
             * `overflow-x-auto` alone is a trap: CSS computes the other axis
             * as `auto` too the moment one of them is not `visible`, so a
             * single pixel of vertical overflow raises a vertical scrollbar
             * beside the tabs. The indicator used to be an absolutely
             * positioned bar at `-bottom-px`, which is exactly that pixel.
             */
            className={cn(
                "flex items-stretch gap-1 overflow-x-auto overflow-y-hidden border-b border-border",
                className,
            )}
        >
            {tabs.map((tab, at) => {
                const selected = tab.id === activeId;
                return (
                    <button
                        key={tab.id}
                        ref={(node) => { refs.current[tab.id] = node; }}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(tab.id)}
                        onKeyDown={(event) => move(event, at)}
                        /*
                         * The indicator is the button's own bottom border, and
                         * it stays inside the button's box. The usual trick is
                         * `-mb-px` so it lands exactly on the rail's line, and
                         * that pixel is what a scrollbar appeared for: a flex
                         * item with a negative bottom margin still counts its
                         * border box as scrollable overflow. The focus ring is
                         * inset for the same reason.
                         */
                        className={cn(
                            "flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm font-medium",
                            "border-b-2 transition-colors duration-150 cursor-pointer",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-inset rounded-t-md",
                            selected
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {tab.icon ? <NavIcon name={tab.icon} className="w-4 h-4" aria-hidden="true" /> : null}
                        {tab.label}
                        {typeof tab.count === "number" ? (
                            <span
                                className={cn(
                                    "rounded-full px-1.5 py-0.5 text-[11px] leading-none tabular-nums",
                                    selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                                )}
                            >
                                {tab.count}
                            </span>
                        ) : null}
                        {tab.trailing}
                    </button>
                );
            })}
        </div>
    );
}
