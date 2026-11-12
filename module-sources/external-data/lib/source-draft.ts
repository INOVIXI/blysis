/**
 * What an operator is allowed to save as a source.
 *
 * `query.ts` refuses a table or column name that is not a plain name, and
 * says why at length: an identifier is the one thing SQL will not let you
 * bind, so whatever goes there is concatenated, and refusing is the only thing
 * you cannot get subtly wrong.
 *
 * This is the other end of that decision, and it asks the same function rather
 * than repeating the rule. A screen accepting a name the reader will refuse
 * stores a source that is listed, looks configured, and answers an error to
 * every visitor for ever - the operator finds out from a page rather than from
 * the form they filled in. Worse in the long run, a table full of names the
 * reader refuses is an invitation for somebody to "fix" the reader by escaping
 * them instead.
 */

import { safeIdentifier } from "./query";

export type SourceRefusal =
    | "bad_slug"
    | "no_title"
    | "bad_table"
    | "no_columns"
    | "bad_column"
    | "bad_order";

export interface SourceDraft {
    slug: string;
    title: string;
    table: string;
    columns: string[];
    /** Empty leaves the order to the database. */
    orderBy: string;
    rowLimit: number;
    cacheSeconds: number;
}

/** Lowercase, digits and hyphens: it becomes part of an address. */
const SLUG = /^[a-z0-9-]+$/;

export function checkSourceDraft(draft: SourceDraft): SourceRefusal | null {
    const slug = draft.slug.trim();
    if (slug === "" || slug.length > 80 || !SLUG.test(slug)) return "bad_slug";
    if (draft.title.trim() === "") return "no_title";

    if (!safeIdentifier(draft.table)) return "bad_table";

    // The reader refuses a select with nothing to select, so this refuses to
    // store one. Named columns only is decided in `query.ts`; the point here
    // is that an empty list never reaches it.
    const columns = draft.columns.map((column) => column.trim()).filter((column) => column !== "");
    if (columns.length === 0) return "no_columns";
    for (const column of columns) {
        if (!safeIdentifier(column)) return "bad_column";
    }

    if (draft.orderBy.trim() !== "" && !safeIdentifier(draft.orderBy)) return "bad_order";

    return null;
}

/** The bounds the reader would clamp to anyway, applied before storing. */
export function boundedSource(draft: SourceDraft): { rowLimit: number; cacheSeconds: number } {
    const rows = Number.isFinite(draft.rowLimit) ? Math.floor(draft.rowLimit) : 20;
    const seconds = Number.isFinite(draft.cacheSeconds) ? Math.floor(draft.cacheSeconds) : 60;
    return {
        rowLimit: Math.min(1000, Math.max(1, rows)),
        // A source cached for nothing is somebody else's database asked on
        // every page view, which is the load this module is careful about.
        cacheSeconds: Math.min(86_400, Math.max(5, seconds)),
    };
}

/**
 * Whose translations a source's are, in core's table, and the field that
 * has them: its title, held to the column's own limit. The table, the columns
 * and the rows are another database's names and are never translated.
 */
export const SOURCE_TEXT = { owner: "external-data", entity: "source" };
export const SOURCE_TRANSLATED_FIELDS = { title: 160 };
