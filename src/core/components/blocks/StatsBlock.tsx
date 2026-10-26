"use client";

import { useTranslations } from "next-intl";
import { Slot, useSlotHasContent } from "@/core/components/Slot";
import { StatTile } from "@/core/components/ui/stat-tile";
import { useBlockText } from "@/core/hooks/useBlockText";
import type { BlockProps } from "@/core/lib/page-blocks";

/**
 * `core.stats`: a row of the site's numbers. The tiles modules give the
 * `home.stats` slot come first, live ones such as players online; then up
 * to three from the block's own settings, which a theme usually leaves to
 * the operator through its settings screen. A tile with no value is not
 * drawn, and with nothing to draw the block draws nothing.
 */
export function StatsBlock({ settings }: BlockProps) {
    const t = useTranslations("common");
    const text = useBlockText();
    const fromModules = useSlotHasContent("home.stats");
    const tiles = [1, 2, 3]
        .map((n) => ({
            n,
            value: text(settings[`tile${n}Value`]).trim(),
            label: text(settings[`tile${n}Label`]),
            icon: typeof settings[`tile${n}Icon`] === "string" ? (settings[`tile${n}Icon`] as string) : null,
        }))
        .filter((tile) => tile.value);

    if (!fromModules && tiles.length === 0) return null;

    return (
        <section data-stats aria-label={t("statsLabel")} className="grid grid-cols-1 gap-4 @md:grid-cols-2 @4xl:grid-cols-4">
            <Slot name="home.stats" />
            {tiles.map((tile) => (
                <StatTile key={tile.n} value={tile.value} label={tile.label} icon={tile.icon} />
            ))}
        </section>
    );
}
