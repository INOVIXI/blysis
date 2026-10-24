/**
 * The words a page's arrangement is written in.
 *
 * A cell offers a block one of three widths: `full` runs edge to edge,
 * `wide` is the page column or two thirds of it, `narrow` is a third, a
 * quarter or half of it. A block says which of these it can be drawn in and
 * a cell says which it offers, so "this block fits here" is a question with
 * an answer rather than a screenshot.
 *
 * Imports nothing from the manifest schemas: both of them import this file.
 */
import { z } from "zod";

export const WIDTH_CLASSES = ["full", "wide", "narrow"] as const;

export type WidthClass = (typeof WIDTH_CLASSES)[number];

/**
 * How a row divides the page column. `full` runs edge to edge; the others sit
 * in the column, a number per cell giving its share.
 */
export const ROW_SPLITS = ["full", "1", "1-1", "2-1", "1-2", "1-1-1", "1-1-1-1"] as const;

export type RowSplit = (typeof ROW_SPLITS)[number];

const CELL_WIDTHS: Record<RowSplit, WidthClass[]> = {
    "full": ["full"],
    "1": ["wide"],
    "1-1": ["narrow", "narrow"],
    "2-1": ["wide", "narrow"],
    "1-2": ["narrow", "wide"],
    "1-1-1": ["narrow", "narrow", "narrow"],
    "1-1-1-1": ["narrow", "narrow", "narrow", "narrow"],
};

/** The width each cell of a split offers, first to last. */
export function cellWidths(split: RowSplit): WidthClass[] {
    return CELL_WIDTHS[split];
}

/** The ceilings a document is held to, wherever it came from. */
export const LAYOUT_LIMITS = { rows: 30, instances: 12, hidden: 64, settings: 50 } as const;

const blockInstanceSchema = z.object({
    /** Names this placement, so two of the same block can be told apart. */
    key: z.string().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
    /** `<module>.<entry>`, as `ModuleBlocks` lists it. */
    block: z.string().max(130).regex(/^[a-z0-9-]+\.[A-Za-z0-9_-]+$/),
    settings: z.record(z.string().max(64), z.unknown())
        .refine((s) => Object.keys(s).length <= LAYOUT_LIMITS.settings, "too many settings")
        .optional(),
});

const layoutRowSchema = z.object({
    split: z.enum(ROW_SPLITS),
    cells: z.array(z.array(blockInstanceSchema).max(LAYOUT_LIMITS.instances)).min(1).max(4),
    /** The cell blocks nobody placed go to: a module installed later lands here. */
    rest: z.number().int().min(0).optional(),
});

export const layoutDocumentSchema = z.object({
    rows: z.array(layoutRowSchema).max(LAYOUT_LIMITS.rows),
    /** Blocks the operator took off the page, so they are not added back. */
    hidden: z.array(z.string().max(130)).max(LAYOUT_LIMITS.hidden).optional(),
}).superRefine((doc, ctx) => {
    const keys = new Set<string>();
    let rests = 0;
    doc.rows.forEach((row, r) => {
        if (row.cells.length !== cellWidths(row.split).length) {
            ctx.addIssue({ code: "custom", path: ["rows", r, "cells"], message: `a ${row.split} row has ${cellWidths(row.split).length} cells` });
        }
        if (row.rest !== undefined) {
            rests++;
            if (row.rest >= row.cells.length) ctx.addIssue({ code: "custom", path: ["rows", r, "rest"], message: "rest names a cell the row does not have" });
        }
        row.cells.forEach((cell, c) => cell.forEach((instance, i) => {
            if (keys.has(instance.key)) ctx.addIssue({ code: "custom", path: ["rows", r, "cells", c, i, "key"], message: `key "${instance.key}" is used twice` });
            keys.add(instance.key);
        }));
    });
    if (rests > 1) ctx.addIssue({ code: "custom", path: ["rows"], message: "only one row may take the blocks nobody placed" });
});

export type LayoutDocument = z.infer<typeof layoutDocumentSchema>;
export type LayoutRow = LayoutDocument["rows"][number];
export type BlockInstance = LayoutRow["cells"][number][number];
