/**
 * Answers `{servers.online}`: everyone playing right now, counted as the
 * homepage's tile counts it. Null when no server can be asked, so a sentence
 * shows its fallback rather than claiming nobody is on.
 */
import { getAllServerStatuses } from "../lib/server-query";
import { playersOnline } from "../lib/players-online";

export default async function online(): Promise<number | null> {
    return playersOnline(await getAllServerStatuses());
}
