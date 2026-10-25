/** What the public status endpoint says of a server, as far as a count needs. */
export interface CountedServer {
    queryable: boolean;
    online: boolean;
    players: { online: number };
}

/**
 * Everyone playing on the servers that can be asked, or null when none can.
 *
 * A game this module cannot ask has no count to add, and a server that is
 * down has nobody on it whatever its last answer said. With no server that
 * can be asked there is no number at all, which is not the same as nobody.
 */
export function playersOnline(servers: CountedServer[]): number | null {
    const asked = servers.filter((s) => s.queryable);
    if (asked.length === 0) return null;
    return asked.reduce((sum, s) => sum + (s.online ? s.players.online : 0), 0);
}

/** Whether any server that can be asked answered. */
export function anyOnline(servers: CountedServer[]): boolean {
    return servers.some((s) => s.queryable && s.online);
}

/**
 * The room on the servers that can be asked and answered, or null when none
 * can be asked: the same servers `playersOnline` counts, so "128 of 500" adds
 * up.
 */
export function playerSlots(servers: (CountedServer & { players: { max: number } })[]): number | null {
    const asked = servers.filter((s) => s.queryable);
    if (asked.length === 0) return null;
    return asked.reduce((sum, s) => sum + (s.online ? s.players.max : 0), 0);
}
