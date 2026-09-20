import * as React from "react";
import { cn } from "@/core/lib/utils";

/**
 * A small status pill.
 *
 * Every screen had written its own: `px-2 py-0.5 rounded text-xs font-medium
 * bg-success/10 text-success` for "enabled", the same with red for "failed",
 * with amber for "pending". Two things were wrong with all of them.
 *
 * The palette is fixed. `bg-success/10` is a light green whatever the theme
 * says, so on a dark panel a status badge was a bright chip with dark green
 * text on it, and a theme that recoloured the whole admin could not touch it.
 * Dark mode here is `[data-mode="dark"]` on the root, not Tailwind's `dark:`
 * variant, so the `` written next to some of them never
 * fired either - Tailwind's variant follows the operating system, and the
 * panel's own toggle does not.
 *
 * And they disagreed. Some were `rounded`, some `rounded-full`; some `text-xs`
 * and some `text-[10px]`; the padding came in four sizes; "success" was
 * green-100/green-700 in one place and green-50/green-600 in another.
 *
 * So: one component, five tones, and the colours are the theme's own tokens -
 * which are redefined for dark mode and by every theme, so a badge follows
 * both without knowing about either.
 */

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
    neutral: "bg-muted text-muted-foreground border-border",
    success: "bg-success/10 text-success border-success/25",
    warning: "bg-warning/10 text-warning border-warning/25",
    danger: "bg-destructive/10 text-destructive border-destructive/25",
    info: "bg-primary/10 text-primary border-primary/25",
};

/**
 * The same five tones, painted rather than tinted.
 *
 * Every tone above is a ten-percent wash over whatever is behind it, which is
 * right on a panel and wrong on a photograph: the shop drew "Featured" in
 * warning-on-warning-tint over a saturated blue product banner and the words
 * disappeared into the picture. A badge that sits on an image has to bring its
 * own surface, and the shadow is what keeps its edge off a busy one.
 */
const SOLID_TONES: Record<BadgeTone, string> = {
    neutral: "bg-card text-foreground border-border",
    success: "bg-success text-success-foreground border-success",
    warning: "bg-warning text-warning-foreground border-warning",
    danger: "bg-destructive text-destructive-foreground border-destructive",
    info: "bg-primary text-primary-foreground border-primary",
};

export function badgeClassName(tone: BadgeTone = "neutral", className?: string, solid = false): string {
    return cn(
        // `border-border` is the base rather than a per-tone class so a tone that
        // forgets one still gets a themed hairline instead of the CSS default,
        // which since Tailwind 4 is `currentColor` - a black stroke.
        "inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        solid ? cn(SOLID_TONES[tone], "shadow-sm") : TONES[tone],
        className,
    );
}

export function Badge({
    tone = "neutral",
    solid = false,
    className,
    ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; solid?: boolean }) {
    return <span className={badgeClassName(tone, className, solid)} {...props} />;
}
