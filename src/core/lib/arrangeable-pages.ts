import { ModulePages } from "@/core/generated/module-pages";
import { pagesOf, type ModulePage } from "@/core/lib/page-blocks";

/**
 * Core's own public pages a theme may arrange, declared as a module declares
 * its pages in `module.json`. They go by `core`, the name core's blocks go by,
 * so a theme arranges `core.search` as it arranges any module's page.
 */
export const CORE_PAGES: ModulePage[] = pagesOf("core", {
    pages: [
        {
            id: "activity",
            blocks: [{ id: "feed", widths: ["wide", "full"] }],
            layout: { rows: [{ split: "1", cells: [[{ key: "feed", block: "core.feed" }]] }] },
        },
        {
            id: "search",
            blocks: [{ id: "form", widths: ["wide", "full", "narrow"] }, { id: "results", widths: ["wide", "full"] }],
            layout: { rows: [{ split: "1", cells: [[{ key: "form", block: "core.form" }, { key: "results", block: "core.results" }]] }] },
        },
        {
            id: "profile",
            blocks: [{ id: "account", widths: ["wide", "full"] }],
            layout: { rows: [{ split: "1", cells: [[{ key: "account", block: "core.account" }]] }] },
        },
    ],
});

/** A page a theme may arrange, core's or an installed module's, by its id. */
export function findPage(pageId: string): ModulePage | undefined {
    return CORE_PAGES.find((p) => p.id === pageId) ?? ModulePages.find((p) => p.id === pageId);
}
