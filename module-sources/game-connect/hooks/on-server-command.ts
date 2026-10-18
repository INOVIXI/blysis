/**
 * Answers `server.command` for servers that connect to this site themselves.
 *
 * It runs before RCON. When the target server holds an enabled token, the
 * command is queued for it and the answer is `handled`, so RCON leaves it
 * alone. Any other server gets nothing from here and RCON answers as before.
 *
 * A connected server's deliveries always queue, even while it is down:
 * waiting for it is the point.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { log, prisma } from "@/core/sdk/server";
import { enqueue } from "../lib/queue";
import { defaultServerId } from "../lib/servers";
import crypto from "crypto";

const MAX_COMMAND_LENGTH = 1000;

const onServerCommand: HookHandlerFor<"server.command", "filter"> = async (current, request) => {
    if (current?.handled) return current;
    const command = request?.command?.trim();
    if (!command) return current;

    const delivery = request.delivery;
    const targetCurrent = delivery?.target === "player";

    let gameServerId: string | null = null;
    if (targetCurrent) {
        const any = await prisma.gameConnectServer.count({ where: { enabled: true } });
        if (any === 0) return current;
    } else {
        gameServerId = request.serverId ?? (await defaultServerId());
        if (!gameServerId) return current;
        const connected = await prisma.gameConnectServer.findUnique({
            where: { gameServerId },
            select: { enabled: true },
        });
        if (!connected?.enabled) return current;
    }

    if (command.length > MAX_COMMAND_LENGTH) {
        return { handled: true, ok: false, output: null, error: "The command is too long to queue" };
    }

    try {
        await enqueue({
            command,
            gameServerId,
            targetCurrent,
            whenOnline: delivery?.whenOnline ?? false,
            player: delivery?.player ?? { name: "", id: null, userId: null },
            groupKey: delivery?.groupKey ?? `manual:${crypto.randomUUID()}`,
            sequence: delivery?.sequence ?? 0,
            reference: delivery?.reference ?? { kind: "manual", id: null, label: null },
        });
        return { handled: true, ok: true, output: "Queued for the game server", error: null, queued: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        log.error("[game-connect] a delivery could not be queued", { error: message, gameServerId });
        return { handled: true, ok: false, output: null, error: "The delivery could not be queued" };
    }
};

export default onServerCommand;
