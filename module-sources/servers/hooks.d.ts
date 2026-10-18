/**
 * The `server.command` contract.
 *
 * Modules never import each other, so a store that has just taken a payment
 * cannot call into this module to run the delivery command. It asks instead,
 * through a filter, and whoever can answer does.
 *
 * The shape is declared here rather than in the modules that emit it, which
 * inverts the usual rule that the emitter owns the payload. It is the right
 * way round for this hook: the value flowing through the chain is the *answer*,
 * and this module is the one that produces it. Two modules already emit the
 * hook (store, minecraft-link) and only this one answers, so putting the
 * declaration in an emitter would mean two copies of it - a duplicate global
 * the moment both are installed.
 *
 * `handled` is what tells a caller the difference between "the command failed"
 * and "nothing on this install can run commands at all". A store with no
 * game-server module installed gets `handled: false` and can say so, rather
 * than reporting a delivery failure that nobody can fix.
 */

declare global {
    interface ServerCommandResult {
        /** True once some module has attempted the command. */
        handled: boolean;
        /** Whether the server accepted it. */
        ok: boolean;
        /** The server's reply, when there was one. */
        output: string | null;
        /** Why it failed, when it did. */
        error: string | null;
        /**
         * True when the command was not run but put in a queue a game server
         * will collect. `ok` then means "accepted", not "ran".
         */
        queued?: boolean;
    }

    /**
     * What a caller knows about a delivery beyond the command line.
     *
     * RCON ignores all of it: it runs the line now or fails. A module that
     * queues for a game server uses it to wait for the right player on the
     * right server and to keep one purchase's lines in order.
     */
    interface ServerCommandDelivery {
        /** "server" runs on `serverId`; "player" runs wherever the player is. */
        target: "server" | "player";
        /** Wait until the player is on the target server. */
        whenOnline: boolean;
        player: { name: string; id: string | null; userId: string | null };
        /** Lines that must run together and in order share a key. */
        groupKey: string;
        sequence: number;
        reference: { kind: "order" | "chest" | "gift" | "manual"; id: string | null; label: string | null };
    }

    interface ServerCommandRequest {
        /** The command line, already fully substituted and sanitised by the caller. */
        command: string;
        /** Which server to run it on. Omitted means the install's default server. */
        serverId?: string | null;
        /** Optional. A caller that knows who and why says so here. */
        delivery?: ServerCommandDelivery;
    }

    /** A game server as another module may see it. */
    interface GameServerSummary {
        id: string;
        name: string;
        type: string;
        isDefault: boolean;
        isActive: boolean;
        order: number;
    }

    interface BlysisFilterPayloads {
        "server.command": ServerCommandResult;
        /** Every game server, in the order an admin arranged them. */
        "servers.list": GameServerSummary[];
    }

    /** The question, as opposed to the answer above. */
    interface BlysisFilterContexts {
        "server.command": ServerCommandRequest;
        "servers.list": Record<string, never>;
    }
}

export {};
