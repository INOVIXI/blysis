import type { CatalogBlock } from "@/core/lib/page-blocks";
import type { ThemeFieldDef } from "@/core/lib/theme-manifest-schema";

/** One tile's three fields, for each of the three tiles. */
function tileFields(): Record<string, ThemeFieldDef> {
    const fields: Record<string, ThemeFieldDef> = {};
    for (const n of [1, 2, 3]) {
        fields[`tile${n}Value`] = { type: "text", max: 40 };
        fields[`tile${n}Label`] = { type: "text", max: 80 };
        fields[`tile${n}Icon`] = { type: "text", max: 64 };
    }
    return fields;
}

/**
 * The blocks that belong to no module: what a theme builds a page from when
 * nothing installed has it to give. None of them is visible by default, so a
 * page only shows one its theme placed.
 */
export const CORE_BLOCKS: CatalogBlock[] = [
    {
        id: "core.stats",
        module: "core",
        entryId: "stats",
        component: "blocks/StatsBlock",
        widths: ["full", "wide"],
        defaultOrder: 0,
        defaultVisible: false,
        settings: tileFields(),
        replaces: [],
    },
];
