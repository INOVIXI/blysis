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
export const WIDTH_CLASSES = ["full", "wide", "narrow"] as const;

export type WidthClass = (typeof WIDTH_CLASSES)[number];
