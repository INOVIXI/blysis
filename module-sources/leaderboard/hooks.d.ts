/**
 * What a board is, and who fills it.
 *
 * This module used to query three tables it does not own: the shop's `Order`,
 * the forum's `ForumPost` and the vote module's `VoteLog`, each behind a "is
 * this model installed?" check. That is a module knowing the name of another
 * module's table and the shape of a feature it does not ship, and it meant
 * the only way to rank anything new was to edit this module.
 *
 * So the direction is the other way round now. This module owns the page, the
 * tabs and the ranking; a module that has something worth ranking answers the
 * filter and appends its board. A site with no shop installed has no "top
 * buyers" tab because nobody offered one, not because a check here failed.
 */
interface LeaderboardRow {
    username: string;
    avatar: string | null;
    /** Money in the site currency, or a count. `unit` says which. */
    value: number;
    /**
     * Where this row came in the ranking, counted from 1.
     *
     * Said by the module that ordered the board rather than worked out from
     * where the row landed in the array. The page used to print the array
     * position, which is the same number right up until a reader narrows the
     * board - and then the fifth place holder is the only row left and gets
     * called first.
     */
    rank: number;
}

interface LeaderboardBoard {
    /** Unique among boards; the tab in the address is this. */
    id: string;
    /**
     * A full message key, namespace and all, because the label belongs to the
     * module that offers the board rather than to this one.
     */
    labelKey: string;
    /** A lucide icon name, drawn beside the label. */
    icon: string;
    /** How to read `value`: as money, or as a number of things. */
    unit: "currency" | "count";
    /** Empty when the filter asked only which boards exist. */
    rows: LeaderboardRow[];
}

declare global {
    interface BlysisFilterPayloads {
        /** Every board this install can show, in the order modules answered. */
        "leaderboard.boards": LeaderboardBoard[];
    }

    interface BlysisFilterContexts {
        /**
         * `boardId` is null when the page only needs to know which tabs to
         * draw; then a module appends its board with no rows, which costs
         * nothing. When it names a board, the module that owns it fills it and
         * the others answer as before.
         */
        "leaderboard.boards": {
            boardId: string | null;
            limit: number;
            /**
             * A name to look for. Matched after the ordering, so a row keeps
             * the rank it really has.
             */
            search?: string;
            /**
             * Count only what happened since this moment. Narrowing in the
             * database rather than after it: "this month" means a month's
             * activity ranked, not a month's rows taken out of an all-time
             * ranking.
             */
            since?: Date | null;
        };
    }
}

export {};
