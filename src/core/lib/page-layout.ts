import { isWidgetVisible, orderWidgets } from "@/core/lib/homepage-widgets";
import { sortBlocks, type CatalogBlock } from "@/core/lib/page-blocks";
import { cellWidths, type LayoutDocument, type RowSplit, type WidthClass } from "@/core/lib/page-layout-schema";
import { sanitizeSettingValue, settingDefault } from "@/core/lib/setting-field-value";

/** One block as the page draws it: where it stands and what it was told. */
export interface ResolvedInstance {
    key: string;
    block: CatalogBlock;
    settings: Record<string, unknown>;
    width: WidthClass;
}

export interface ResolvedRow {
    split: RowSplit;
    cells: ResolvedInstance[][];
}

export interface ResolvedLayout {
    rows: ResolvedRow[];
    /** Nothing stands in a wide or full cell, which is when the page greets a new site instead. */
    welcome: boolean;
}

interface ResolveInput {
    themeLayout: LayoutDocument | undefined;
    /** Every block the registry lists, installed or not switched on. */
    blocks: CatalogBlock[];
    enabled: (module: string) => boolean;
    /** Site settings; only the two the old widgets screen wrote are read. */
    settings: Record<string, unknown>;
}

const keyOf = (block: CatalogBlock) => block.id.replace(/\./g, "-");

/** The id the old widgets screen saved this block under. */
const legacyId = (block: CatalogBlock) => block.replaces[0] ?? block.entryId;

/**
 * Rows for blocks nobody placed: a block that needs the whole width in a
 * full row, then a two thirds and one third row with what fits the wide cell
 * on the left and the rest on the right, the way the homepage always stood.
 */
function rowsFor(blocks: CatalogBlock[], keyFor: (b: CatalogBlock) => string = keyOf): LayoutDocument["rows"] {
    const instance = (b: CatalogBlock) => ({ key: keyFor(b), block: b.id });
    const fullOnly = blocks.filter((b) => !b.widths.includes("wide") && !b.widths.includes("narrow"));
    const wide = blocks.filter((b) => b.widths.includes("wide"));
    const narrow = blocks.filter((b) => !b.widths.includes("wide") && b.widths.includes("narrow"));
    const rows: LayoutDocument["rows"] = [];
    if (fullOnly.length > 0) rows.push({ split: "full", cells: [fullOnly.map(instance)] });
    if (wide.length > 0 || narrow.length > 0) rows.push({ split: "2-1", cells: [wide.map(instance), narrow.map(instance)] });
    return rows;
}

/**
 * The arrangement under a theme that ships none: the homepage as it has
 * always been, under a full row for any block that needs the whole width.
 * It places only what needs more than the narrow column. The widgets come in
 * through its `rest` cell, in the order and with the visibility Settings >
 * Widgets saved, the way they do under any theme.
 */
function coreDefaultLayout(blocks: CatalogBlock[], visibility: unknown): LayoutDocument {
    const placed = blocks.filter((b) => (b.widths.includes("wide") || !b.widths.includes("narrow"))
        && isWidgetVisible({ id: legacyId(b), defaultVisible: b.defaultVisible }, visibility));
    const rows = rowsFor(placed);
    if (!rows.some((r) => r.split === "2-1")) rows.push({ split: "2-1", cells: [[], []] });
    return { rows: rows.map((r) => (r.split === "2-1" ? { ...r, rest: 1 } : r)) };
}

/** Every setting the block declares, as given when it may hold it, else its default. */
function settingsOf(block: CatalogBlock, given: Record<string, unknown> | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(block.settings)) {
        const raw = given?.[key];
        const clean = raw === undefined ? undefined : sanitizeSettingValue(def, raw);
        out[key] = clean ?? settingDefault(def);
    }
    return out;
}

/**
 * What the homepage draws: the theme's arrangement, else core's. Then a block
 * of a module that is gone or switched off is left out, a block is drawn only
 * in a cell whose width it declares, every setting is one its field allows,
 * and a block the document never named and did not hide goes to its `rest`
 * cell, or to rows of its own.
 *
 * Settings > Widgets holds over any arrangement, since it is all an operator
 * has: a widget switched off there is drawn nowhere, whoever placed it, and
 * the widgets the page adds itself come in the order saved there.
 */
export function resolveLayout(input: ResolveInput): ResolvedLayout {
    const usable = sortBlocks(input.blocks.filter((b) => input.enabled(b.module)));
    const byId = new Map(usable.map((b) => [b.id, b]));
    const doc = input.themeLayout ?? coreDefaultLayout(usable, input.settings.widget_visibility);

    const named = new Set(doc.rows.flatMap((row) => row.cells.flat().map((i) => i.block)));
    const hidden = new Set(doc.hidden ?? []);
    const visibility = input.settings.widget_visibility as Record<string, unknown> | undefined;
    const switchedOff = (block: CatalogBlock) => visibility?.[legacyId(block)] === false;
    let unnamed = orderWidgets(
        usable
            .filter((b) => !named.has(b.id) && !hidden.has(b.id))
            .map((block) => ({ id: legacyId(block), defaultVisible: block.defaultVisible, block }))
            .filter((w) => isWidgetVisible(w, visibility)),
        input.settings.widget_order,
    ).map((w) => w.block);
    // A block the page adds is keyed by its id, unless a placement the
    // document made already holds that key.
    const keys = new Set(doc.rows.flatMap((row) => row.cells.flat().map((i) => i.key)));
    const freshKey = (block: CatalogBlock) => {
        let key = keyOf(block);
        for (let n = 2; keys.has(key); n++) key = `${keyOf(block)}-${n}`;
        keys.add(key);
        return key;
    };

    const draw = (rows: LayoutDocument["rows"]): ResolvedRow[] => rows.map((row) => {
        const widths = cellWidths(row.split);
        const cells = row.cells.map((cell, c) => cell.flatMap((instance) => {
            const block = byId.get(instance.block);
            if (!block || !block.widths.includes(widths[c]) || switchedOff(block)) return [];
            return [{ key: instance.key, block, settings: settingsOf(block, instance.settings), width: widths[c] }];
        }));
        if (row.rest !== undefined) {
            const width = widths[row.rest];
            const fits = unnamed.filter((b) => b.widths.includes(width));
            cells[row.rest].push(...fits.map((block) => ({ key: freshKey(block), block, settings: settingsOf(block, undefined), width })));
            unnamed = unnamed.filter((b) => !fits.includes(b));
        }
        return { split: row.split, cells };
    });

    const rows = draw(doc.rows);
    if (unnamed.length > 0) rows.push(...draw(rowsFor(unnamed, freshKey)));

    const welcome = !rows.some((row) => {
        const widths = cellWidths(row.split);
        return row.cells.some((cell, c) => widths[c] !== "narrow" && cell.length > 0);
    });
    return { rows, welcome };
}
