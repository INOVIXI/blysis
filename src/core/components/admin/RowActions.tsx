"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "@/core/lib/i18n/navigation";
import { Button, buttonClassName } from "@/core/components/ui/button";
import { cn } from "@/core/lib/utils";

/**
 * What you can do to a row, drawn the same way on every screen.
 *
 * Measured across the panel on 2026-09-19: 40 controls sitting in a row of a
 * list, 23 an icon with a name and 17 an icon with its label written beside
 * it. So Edit was a small grey pencil on one screen and a button reading
 * "Edit" two screens over, and an operator moving between them had to look
 * for a different thing each time.
 *
 * Neither shape is wrong on its own; what is wrong is that the choice was
 * made forty times. A row has room for two or three actions and no room for
 * their labels, so the icon carries the meaning and the name is there for
 * whoever cannot see it. That also makes the name compulsory rather than
 * nice: an icon with no name is a control a screen reader reads as nothing.
 *
 * A caller passes what its rows can do. It does not pass a size, a variant or
 * a gap, because those are exactly the things that drifted.
 */
export interface RowAction {
    icon: LucideIcon;
    /** Read aloud in place of the icon, and shown on hover. Not optional. */
    label: string;
    onClick?: () => void;
    /** Given instead of `onClick` when the action is going somewhere. */
    href?: string;
    /** Tinted, because losing something should not look like editing it. */
    destructive?: boolean;
    /** Left out entirely. A dead control still asks to be pressed. */
    hidden?: boolean;
    disabled?: boolean;
}

export interface RowActionsProps {
    actions: RowAction[];
    className?: string;
}

export function RowActions({ actions, className }: RowActionsProps) {
    const shown = actions.filter((action) => !action.hidden);

    // An empty strip still takes the width of its column, and a table with an
    // actions column and nothing in it reads as broken rather than as empty.
    if (shown.length === 0) return null;

    return (
        <div className={cn("flex items-center justify-end gap-1", className)}>
            {shown.map(({ icon: Icon, label, onClick, href, destructive, disabled }) =>
                href ? (
                    <Link
                        key={label}
                        href={href}
                        aria-label={label}
                        title={label}
                        className={buttonClassName("ghost", "sm", destructive ? "text-destructive hover:text-destructive" : undefined)}
                    >
                        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    </Link>
                ) : (
                    <Button
                        key={label}
                        type="button"
                        aria-label={label}
                        title={label}
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={onClick}
                        className={destructive ? "text-destructive hover:text-destructive" : undefined}
                    >
                        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                ),
            )}
        </div>
    );
}
