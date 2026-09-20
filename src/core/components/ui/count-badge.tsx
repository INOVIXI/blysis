"use client";

import * as React from "react";
import { cn } from "@/core/lib/utils";

/**
 * The number on the corner of an icon button.
 *
 * The bell and the cart each wrote their own, identically and wrongly: a
 * 16-pixel circle on a 16-pixel icon, sitting half on top of it. At that size
 * the badge is not a mark on the icon, it is a second icon - the thing a
 * reader sees first in the header is a red disc, and what it is attached to is
 * a guess. It had no ring either, so on a dark navbar the red ran straight
 * into the bell.
 *
 * Smaller than the glyph it marks, with a ring in the surface colour so it
 * reads as sitting above rather than merged into it, and wide enough for two
 * characters because "9+" was being squeezed into a circle sized for "1".
 *
 * The caller's button has to be `relative`; that is where it hangs from.
 */

export type CountBadgeTone = "danger" | "primary";

const TONES: Record<CountBadgeTone, string> = {
    danger: "bg-destructive text-destructive-foreground",
    primary: "bg-primary text-primary-foreground",
};

export interface CountBadgeProps {
    count: number;
    tone?: CountBadgeTone;
    /** Above this, the badge says "N+" rather than growing. */
    max?: number;
    /** The colour the ring separates it from. */
    ringClassName?: string;
    className?: string;
}

export function CountBadge({
    count,
    tone = "danger",
    max = 9,
    ringClassName = "ring-card",
    className,
}: CountBadgeProps) {
    if (count <= 0) return null;
    return (
        <span
            aria-hidden="true"
            className={cn(
                "pointer-events-none absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center",
                "rounded-full px-1 text-[9px] font-bold leading-none tabular-nums ring-2",
                TONES[tone],
                ringClassName,
                className,
            )}
        >
            {count > max ? `${max}+` : count}
        </span>
    );
}
