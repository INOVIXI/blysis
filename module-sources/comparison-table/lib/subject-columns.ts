/**
 * Keeping a subject's columns in step with the subject.
 *
 * A table about a shop category has one column per product on that shelf, and
 * nobody types them: a product added to the category appears as a column, one
 * taken out stops being drawn. What the operator owns is the rows and the
 * cells - the features and the answers - and those have to survive all of it.
 *
 * So a column is kept rather than deleted when its source goes. Deleting it
 * takes every answer in it, and a product moved off a shelf this week is
 * often back on it next week; a column nobody can see costs a row in a table
 * and an operator's afternoon is worth more than that.
 *
 * `label` is written down at reconcile time and left alone afterwards. It is
 * the fallback for the day the answering module is uninstalled: the table
 * then reads the way a typed one does, rather than losing its heading.
 */

import { applyFiltersAsync } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";
import type { ComparisonColumnSource } from "../hooks.d";

export interface ReconciledColumn {
    id: string;
    order: number;
    /** What the owning module says about it now. Null when nothing answered. */
    source: ComparisonColumnSource | null;
    /** The heading to draw when nothing answered. */
    label: string;
    subtitle: string | null;
    href: string | null;
    highlight: boolean;
}

/** What the subject says its columns are, right now, for this reader. */
export async function columnsOf(subjectRef: string, locale?: string): Promise<ComparisonColumnSource[]> {
    return applyFiltersAsync("comparison.columns", [], { subjectRef, locale });
}

/**
 * Bring a table's columns into line with its subject, and answer with what to
 * draw, in the subject's own order.
 *
 * Idempotent, and called by both the screen an operator edits and the page a
 * visitor reads, so the two cannot disagree about what the columns are.
 */
export async function reconcileColumns(
    tableId: string,
    subjectRef: string,
    locale?: string,
): Promise<ReconciledColumn[]> {
    const sources = await columnsOf(subjectRef, locale);

    const existing = await prisma.comparisonColumn.findMany({
        where: { tableId },
        select: { id: true, sourceRef: true, label: true, subtitle: true, href: true, highlight: true, order: true },
        // A table is twelve columns at the outside - the save refuses more -
        // and a ceiling is cheaper than trusting that to stay true.
        take: 50,
    });
    const bySource = new Map(existing.filter((c) => c.sourceRef).map((c) => [c.sourceRef as string, c]));

    const drawn: ReconciledColumn[] = [];
    for (const [index, source] of sources.entries()) {
        const already = bySource.get(source.ref);
        if (already) {
            // The heading and the order follow the subject; the cells do not
            // move, because they hang off the column's id and that is the one
            // thing here that never changes.
            if (already.label !== source.label || already.order !== index) {
                await prisma.comparisonColumn.update({
                    where: { id: already.id },
                    data: { label: source.label, order: index },
                });
            }
            drawn.push({
                id: already.id,
                order: index,
                source,
                label: source.label,
                subtitle: already.subtitle,
                href: source.href ?? already.href,
                highlight: source.highlight ?? already.highlight,
            });
            continue;
        }

        const created = await prisma.comparisonColumn.create({
            data: {
                tableId,
                sourceRef: source.ref,
                label: source.label,
                subtitle: source.subtitle ?? null,
                href: source.href ?? null,
                highlight: source.highlight ?? false,
                order: index,
            },
            select: { id: true, subtitle: true, href: true, highlight: true },
        });
        drawn.push({
            id: created.id,
            order: index,
            source,
            label: source.label,
            subtitle: created.subtitle,
            href: source.href ?? created.href,
            highlight: source.highlight ?? created.highlight,
        });
    }

    return drawn;
}
