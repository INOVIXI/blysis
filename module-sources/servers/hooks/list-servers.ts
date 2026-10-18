/**
 * Answers `servers.list`: the game servers this site knows, in the order an
 * admin arranged them.
 *
 * Another module that needs a server's name, or which one is the default, asks
 * here rather than reading this module's table. Only the fields a stranger may
 * see go out; the RCON port and password never leave `server-fields.ts`.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

const listServers: HookHandlerFor<"servers.list", "filter"> = async (current) => {
    if (current && current.length > 0) return current;
    const rows = await prisma.gameServer.findMany({
        orderBy: { order: "asc" },
        select: { id: true, name: true, type: true, isDefault: true, isActive: true, order: true },
    });
    return rows;
};

export default listServers;
