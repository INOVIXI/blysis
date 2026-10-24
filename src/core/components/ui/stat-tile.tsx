import type { ReactNode } from "react";
import { NavIcon } from "@/core/components/ui/NavIcon";

interface StatTileProps {
    value: ReactNode;
    label: ReactNode;
    /** A Lucide icon by name; none draws no icon box. */
    icon?: string | null;
}

/**
 * One number and what it counts. Core's stats row draws its own tiles with
 * it and a module hands the row its live ones with it, so a theme styles one
 * tile (`data-stat-tile`) and every tile in the row matches.
 */
export function StatTile({ value, label, icon }: StatTileProps) {
    return (
        <div data-stat-tile className="flex min-w-0 items-center gap-3.5 rounded-lg border border-border bg-card px-5 py-4">
            {icon ? (
                <span data-stat-icon aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <NavIcon name={icon} className="h-5 w-5" />
                </span>
            ) : null}
            <span className="min-w-0">
                <span data-stat-value className="block truncate text-2xl font-bold text-foreground">{value}</span>
                <span data-stat-label className="block text-sm font-medium text-muted-foreground">{label}</span>
            </span>
        </div>
    );
}
