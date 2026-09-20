/**
 * What a table asks the rest of the site to compare.
 *
 * A comparison table is a general thing - plans, ranks, packages, tools - and
 * it stays general by never learning what any of them are. It knows there is
 * a *subject*, named by an opaque string somebody else minted, and that
 * whoever minted it can say what the columns of that subject are and how each
 * one should be drawn.
 *
 * That is the whole seam. The shop answers with the products in one of its
 * categories, so a category displayed as a table has columns that are the
 * things it sells: the live name, the live price, the picture and the way to
 * buy. A hosting module could answer with its plans tomorrow and this file
 * would not change.
 *
 * It replaces a column that was typed by hand with a link beside it. That
 * shape could not carry a price, so a table went stale the day one changed,
 * and the seeded one proved it: its columns read Free, VIP and Gold while the
 * shop sold VIP, VIP+, MVP, MVP+ and Legend.
 */

/** Something a table can be built about. */
export interface ComparisonSubject {
    /** Opaque and minted by the answering module, e.g. `store.category:abc`. */
    ref: string;
    /** What an operator picks it by. */
    label: string;
    /** The kind, for grouping the picker: "Categories", "Plans". */
    group: string;
}

/**
 * One column, as the module that owns it wants it drawn.
 *
 * Everything but `ref` and `label` is optional, because a subject that is not
 * for sale has no price and no way to buy it, and a table of those is still a
 * table.
 */
export interface ComparisonColumnSource {
    /** Opaque, stable, and the key the operator's cells are stored against. */
    ref: string;
    label: string;
    subtitle?: string | null;
    image?: string | null;
    /** What *this reader* pays, in site currency. */
    price?: number | null;
    /** What it cost before, when that is more than the price. */
    was?: number | null;
    /**
     * What somebody with no history pays.
     *
     * Different from `price` only where the owner made this reader a personal
     * offer - the shop's upgrade credit. Kept apart because the two have to be
     * drawn differently: a sale is a percentage off for everybody and belongs
     * on a badge, a personal credit is a line of explanation and does not.
     * Folding them together advertised a 39% discount that was 17% of sale and
     * the rest a credit.
     */
    fullPrice?: number | null;
    /**
     * One line under the price, already in the reader's language.
     *
     * Written by whoever owns the column, because only they know the words
     * for their own offers - "4 left", "you already own VIP, pay 10.00". The
     * table used to read a number out of this and pick the sentence itself,
     * which made the shop's meaning the table's guess.
     */
    note?: string | null;
    /** Where the column's name goes. */
    href?: string | null;
    /** The control that takes the money, where there is one. */
    buyHref?: string | null;
    /** The one the eye should land on. */
    highlight?: boolean;
}

declare global {
    interface BlysisFilterPayloads {
        /** Everything a table could be built about, for the operator's picker. */
        "comparison.subjects": ComparisonSubject[];
        /** The columns of one subject, in the order its owner keeps them. */
        "comparison.columns": ComparisonColumnSource[];
    }

    interface BlysisFilterContexts {
        "comparison.subjects": Record<string, never>;
        /**
         * `locale` because a column's note is prose its owner writes, and the
         * owner is answering an API route with no locale in its path: without
         * being told, next-intl falls back to the default and a Turkish reader
         * was shown "19.99 off: you own a lower rank".
         */
        "comparison.columns": { subjectRef: string; locale?: string };
    }
}

export {};
