/**
 * Giving up on the game server's database.
 *
 * This runs on the scheduler rather than on a page, so a read that hangs does
 * not hold a visitor up - it holds the scheduler's tick, and the next tick
 * behind it, until the process has as many half-open sockets as it has had
 * ticks. A game server's database is frequently on a box that goes away.
 *
 * The deadline is on this side of the socket rather than asked of the server,
 * because the two servers do not agree on how to ask. MySQL's
 * `MAX_EXECUTION_TIME` is one MariaDB has never heard of, and MariaDB is
 * routed to the same driver deliberately. One mechanism covers both, and
 * covers what a server variable never did: a connection that never opens, and
 * a network that stops answering halfway through the rows.
 */

export async function withDeadline<T>(
    work: Promise<T>,
    ms: number,
    /** Closes the connection when the deadline wins, so nothing is left open. */
    abandon?: () => void,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            abandon?.();
            reject(new Error("Read timeout: the LiteBans database did not answer in time"));
        }, ms);
    });

    try {
        return await Promise.race([work, deadline]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
