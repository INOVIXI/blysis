/**
 * Deleting several rows, and saying what actually happened.
 *
 * There is no endpoint that takes a list of ids, so this is several requests -
 * and every answer used to be thrown away. Five rows ticked, four refused by
 * a foreign key, and the panel said "Deleted" and refetched: the operator saw
 * four rows still there and no reason why.
 *
 * Three outcomes, not two. All of them went, none of them went, or some did.
 * The third is the one worth naming, because it is the only one where the
 * screen and the operator's expectation part company.
 *
 * Sequential on purpose. These are deletes against one database; firing twenty
 * at once buys nothing an operator can perceive, and it makes the partial case
 * harder to report honestly.
 */

export interface BulkDeleteResult {
    /** How many rows went. */
    deleted: number;
    /** How many were asked for. */
    total: number;
}

/**
 * `remove` answers whether that row went. A throw counts as a row that did
 * not: a dead network is not a deletion, and must not be reported as one just
 * because nothing returned false.
 */
export async function deleteEach(
    ids: readonly string[],
    remove: (id: string) => Promise<boolean>,
): Promise<BulkDeleteResult> {
    let deleted = 0;
    for (const id of ids) {
        try {
            if (await remove(id)) deleted++;
        } catch {
            // Counted as a failure by not counting it as a success.
        }
    }
    return { deleted, total: ids.length };
}
