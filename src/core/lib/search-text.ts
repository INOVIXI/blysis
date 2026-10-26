import { Prisma } from "@prisma/client";

/**
 * The full-text document a module's search reads, and the match against it.
 *
 * Postgres treats the Turkish dotless ı as a letter of its own and folds an
 * upper-case I to the dotted i, so a reader typing "altin" or "ALTIN" found
 * nothing called "Altın". The document and the query both fold ı and İ first.
 *
 * The index `scripts/ensure-search-indexes.ts` builds and the match a module
 * runs come from the one expression here. Postgres uses an expression index
 * only for the identical expression, and four modules once wrote theirs by
 * hand beside a fifth copy in core. `search-indexes.test.ts` holds them equal.
 */

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

/** What `translate` turns ı and İ into, as SQL text. */
const FOLD = `'ıİ', 'iI'`;

/** The indexed document for a table's searchable columns, as SQL text. */
export function searchDocument(columns: string[]): string {
    for (const column of columns) {
        if (!IDENTIFIER.test(column)) throw new Error(`"${column}" is not a plain column name`);
    }
    const text = columns.map((c) => `coalesce("${c}", '')`).join(" || ' ' || ");
    return `to_tsvector('english', translate(${text}, ${FOLD}))`;
}

function searchQuery(q: string): Prisma.Sql {
    return Prisma.sql`plainto_tsquery('english', translate(${q}, ${Prisma.raw(FOLD)}))`;
}

/** Whether a row's columns match what the reader typed, through the table's index. */
export function searchMatches(columns: string[], q: string): Prisma.Sql {
    return Prisma.sql`${Prisma.raw(searchDocument(columns))} @@ ${searchQuery(q)}`;
}

/** How well a row's columns match what the reader typed, for ordering. */
export function searchRank(columns: string[], q: string): Prisma.Sql {
    return Prisma.sql`ts_rank(${Prisma.raw(searchDocument(columns))}, ${searchQuery(q)})`;
}

/**
 * How many of the i-letters typed are tried both ways. Each doubles the
 * spellings asked for, and a term with more than this many is a sentence:
 * the rest are matched as typed.
 */
const FOLDED_LETTERS = 6;

/**
 * Every spelling of what the reader typed that a list's search asks for.
 *
 * Prisma's case-insensitive `contains` is `ILIKE`, which lowers I, İ and i
 * alike to the dotted i but keeps the dotless ı apart, so "altin" never found
 * "Altın" and "ALTIN" found only one of the two. Each i-letter typed is tried
 * as both i and ı, and `ILIKE` settles the case of everything else. The
 * stored text is compared as it is, so this asks no index and no SQL of its
 * own: an earlier version read matching ids in SQL and handed them back as a
 * list, which a common term on a large table pushed past the parameters
 * Postgres takes.
 */
export function searchSpellings(term: string): string[] {
    let spellings = [""];
    let folded = 0;
    for (const letter of term.trim()) {
        const tryBoth = /[iıIİ]/.test(letter) && folded++ < FOLDED_LETTERS;
        const choices = tryBoth ? ["i", "ı"] : [letter];
        spellings = spellings.flatMap((start) => choices.map((choice) => start + choice));
    }
    return spellings[0] === "" ? [] : spellings;
}

/**
 * The `OR` a list's `where` takes for a search box: any of the fields holds
 * any spelling of what the reader typed. Empty when nothing was typed.
 */
export function textContains<F extends string>(fields: F[], term: string): Partial<Record<F, { contains: string; mode: "insensitive" }>>[] {
    const spellings = searchSpellings(term);
    return fields.flatMap((field) => spellings.map((spelling) => (
        { [field]: { contains: spelling, mode: "insensitive" as const } } as Partial<Record<F, { contains: string; mode: "insensitive" }>>
    )));
}
