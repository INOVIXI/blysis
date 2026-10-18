/**
 * Answers the `server.command` filter: this module can reach game servers, so
 * it runs the command and reports what happened.
 *
 * A failure comes back as a value rather than an exception. The callers are
 * mid-checkout - a thrown error here would turn "the delivery command was
 * refused" into "the order failed", which is the wrong outcome for a payment
 * that already went through.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { log } from "@/core/sdk/server";
import { sendRconCommand } from "../lib/rcon";

const runServerCommand: HookHandlerFor<"server.command", "filter"> = async (current, request) => {
    // Another module took it first, for example one that queues for a game
    // server that connects to the site itself. Running it here as well would
    // deliver it twice.
    if (current?.handled) return current;
    if (!request?.command) {
        return { handled: false, ok: false, output: null, error: "No command given" };
    }

    try {
        const output = await sendRconCommand(request.command, request.serverId);
        return { handled: true, ok: true, output, error: null };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown RCON error";
        log.warn("[servers] a server command failed", { error: message, serverId: request.serverId ?? null });
        return { handled: true, ok: false, output: null, error: message };
    }
};

export default runServerCommand;
