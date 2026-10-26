import type { ComponentType } from "react";
import type { BlockProps } from "@/core/lib/page-blocks";
import { StatsBlock } from "./StatsBlock";

/** What draws each of core's own blocks (`CORE_BLOCKS` in core-blocks.ts). */
export const CORE_BLOCK_COMPONENTS: Record<string, ComponentType<BlockProps>> = {
    "core.stats": StatsBlock,
};
