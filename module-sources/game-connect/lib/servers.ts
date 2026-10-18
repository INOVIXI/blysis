/**
 * The game servers this site knows, asked of the servers module.
 */
import { applyFiltersAsync } from "@/core/sdk";

export async function listGameServers(): Promise<GameServerSummary[]> {
    const list = await applyFiltersAsync("servers.list", [] as GameServerSummary[], {});
    return list ?? [];
}

/** The server a command goes to when it names none: the default, else the first that is on. */
export async function defaultServerId(): Promise<string | null> {
    const active = (await listGameServers()).filter((server) => server.isActive);
    return (active.find((server) => server.isDefault) ?? active[0])?.id ?? null;
}

export async function serverNames(): Promise<Map<string, string>> {
    return new Map((await listGameServers()).map((server) => [server.id, server.name]));
}
