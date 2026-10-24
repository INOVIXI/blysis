import type { ValidatedModuleManifest } from "./module-manifest-schema";
import type { WidthClass } from "./page-layout-schema";
import type { ThemeFieldDef } from "./theme-manifest-schema";

/** One block a page can be arranged from, as the registry lists it. */
export interface CatalogBlock {
    /** `<module>.<entryId>`, the name an arrangement stores. */
    id: string;
    module: string;
    entryId: string;
    label?: string;
    labelKey?: string;
    component: string;
    widths: WidthClass[];
    defaultOrder: number;
    defaultVisible: boolean;
    settings: Record<string, ThemeFieldDef>;
    /** Widget or section ids this block was, so a saved order follows it. */
    replaces: string[];
}

/**
 * What a block component is handed: its settings, checked against its fields
 * with every default filled, and the width class of the cell it stands in.
 * It lays itself out by its box (`@container`), never by the screen.
 */
export interface BlockProps {
    settings: Record<string, unknown>;
    width: WidthClass;
}

type BlockSource = Partial<Pick<ValidatedModuleManifest, "blocks" | "widgets" | "homepageSections">>;

/**
 * Every block one module gives a page: the ones it declares, and each widget
 * and homepage section it still lists, read as a block under its own id.
 *
 * A widget has only ever stood in the homepage's narrow column and a section
 * in its wide one, so those are the widths they keep. A section's `type` was
 * never read by the page, which drew every section in the main column, so it
 * is not read here either. A declared block that `replaces` a widget or
 * section stands in for it, and the old entry is not listed twice.
 */
export function blocksOf(module: string, manifest: BlockSource): CatalogBlock[] {
    const declared: CatalogBlock[] = (manifest.blocks ?? []).map((b) => ({
        id: `${module}.${b.id}`,
        module,
        entryId: b.id,
        label: b.label,
        labelKey: b.labelKey,
        component: b.component,
        widths: [...b.widths],
        defaultOrder: b.defaultOrder,
        defaultVisible: b.defaultVisible,
        settings: b.settings ?? {},
        replaces: b.replaces ?? [],
    }));
    const replaced = new Set(declared.flatMap((b) => b.replaces));

    const widgets: CatalogBlock[] = (manifest.widgets ?? [])
        .filter((w) => !replaced.has(w.id))
        .map((w) => ({
            id: `${module}.${w.id}`,
            module,
            entryId: w.id,
            label: w.label,
            labelKey: w.labelKey,
            component: w.component,
            widths: ["narrow"],
            defaultOrder: w.defaultOrder,
            defaultVisible: w.defaultVisible,
            settings: {},
            replaces: [w.id],
        }));

    const sections: CatalogBlock[] = (manifest.homepageSections ?? [])
        .filter((s) => !replaced.has(s.id))
        .map((s) => ({
            id: `${module}.${s.id}`,
            module,
            entryId: s.id,
            component: s.component,
            widths: ["wide", "full"],
            defaultOrder: s.order,
            defaultVisible: true,
            settings: {},
            replaces: [s.id],
        }));

    return [...declared, ...widgets, ...sections];
}

/**
 * Declared order first, then the id by code point, so two builds list blocks
 * alike whatever the machine's locale.
 */
export function sortBlocks(blocks: CatalogBlock[]): CatalogBlock[] {
    return [...blocks].sort((a, b) => a.defaultOrder - b.defaultOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
