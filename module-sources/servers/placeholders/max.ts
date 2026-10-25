/**
 * Answers `{servers.max}`: the room on the servers that answered, for
 * "128 of 500". Null when no server can be asked.
 */
import { getAllServerStatuses } from "../lib/server-query";
import { playerSlots } from "../lib/players-online";

export default async function max(): Promise<number | null> {
    return playerSlots(await getAllServerStatuses());
}
