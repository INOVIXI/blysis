/**
 * Running the commands a product delivers on purchase.
 *
 * This module used to carry its own RCON client, a near-copy of the one in the
 * servers module that had already drifted from it. It carries none now: the
 * store knows what to run, the servers module knows how to reach a server, and
 * they meet at the `server.command` filter. A store with no game-server module
 * installed gets `handled: false` back and reports that, rather than a
 * connection error nobody can act on.
 *
 * What stays here is the part that is genuinely the store's: turning a product's
 * command template into a command line.
 */
import { applyFiltersAsync } from "@/core/sdk";

/**
 * Placeholders are substituted into a command line that a game server will
 * parse, so a player name of `x; op attacker` has to come out inert. Only
 * letters, digits, and the punctuation that appears in real player and product
 * names survives.
 */
function sanitizeRconArg(input: string): string {
    return input.replace(/[^a-zA-Z0-9_\-. ]/g, "");
}

/**
 * A player name is one argument. With its spaces kept, "Steve 999999" in
 * "eco give {player} 100" paid Steve 999999 and left the 100 over.
 */
function sanitizePlayerName(input: string): string {
    return sanitizeRconArg(input).replace(/ /g, "");
}

/**
 * An order number, or a run named after it, as one argument a game plugin can
 * keep and compare: letters, digits and dashes.
 */
function sanitizeReference(input: string): string {
    return input.replace(/[^a-zA-Z0-9-]/g, "");
}

export interface DeliveryCommand {
    command: string;
    /** Which server to run it on. Null means the install's default server. */
    serverId?: string | null;
    /** `player` runs wherever the buyer is; read only by a queue, never by RCON. */
    target?: string | null;
    /** Wait for the player to be on the target server; read only by a queue. */
    whenOnline?: boolean | null;
}

/** What a delivery is for, so a queue can keep one purchase's lines together. */
export interface DeliveryReference {
    kind: "order" | "chest" | "gift" | "manual";
    id: string | null;
    label: string | null;
}

export interface DeliveryResult {
    success: boolean;
    results: string[];
}

/**
 * What comes back from the `server.command` chain.
 *
 * Spelled out here rather than reusing the servers module's global interface:
 * that declaration only exists when that module is installed, and this one has
 * to compile either way. The shape is checked structurally at the call.
 */
interface CommandOutcome {
    handled: boolean;
    ok: boolean;
    output: string | null;
    error: string | null;
    queued?: boolean;
}

/** Who and why, for a module that queues rather than runs. RCON ignores it. */
interface CommandDelivery {
    target: "server" | "player";
    whenOnline: boolean;
    player: { name: string; id: string | null; userId: string | null };
    groupKey: string;
    sequence: number;
    reference: DeliveryReference;
}

/** Runs one command through whichever module can reach game servers. */
export async function runDeliveryCommand(
    command: string,
    serverId?: string | null,
    delivery?: CommandDelivery,
): Promise<CommandOutcome> {
    return applyFiltersAsync(
        "server.command",
        { handled: false, ok: false, output: null, error: null },
        { command, serverId: serverId ?? null, ...(delivery ? { delivery } : {}) },
    );
}

/**
 * Executes a product's delivery commands in order, stopping at the first
 * failure so a half-delivered purchase is visible rather than silently partial.
 *
 * Commands support `{player}`, `{product}`, `{quantity}`, and any custom
 * variable the product defines, then `{order}`, `{delivery}` and `{unit}`.
 * Those three come last so a product that already named a variable `unit`
 * keeps it, and a buyer's answer cannot carry them: braces never survive
 * `sanitizeRconArg`.
 *
 * `{delivery}` is `<order>-<line>-<unit>` and is the same every time the same
 * unit of the same line is delivered, which is what lets a game plugin refuse
 * a retried run it has already carried out.
 */
export async function deliverProduct(params: {
    playerName: string;
    productName: string;
    commands: DeliveryCommand[];
    quantity?: number;
    variables?: Record<string, string>;
    /** The game account id behind the name, when the caller knows it. */
    playerId?: string | null;
    /** The member the delivery is for, when there is one. */
    userId?: string | null;
    /** What it is for. Lines of one delivery to one place share a group. */
    reference?: DeliveryReference;
    /**
     * Which line of it: the order item or chest row. Two products in one
     * order are two deliveries, each with its own order.
     */
    line?: string | null;
    /**
     * Run the whole list once per unit rather than once per line, for a
     * command that hands out a fixed amount however many were bought.
     */
    perUnit?: boolean;
    /** The number the buyer was shown. Without one, the reference's id. */
    orderNumber?: string | null;
    /** The line's 1-based place in its order. */
    lineNumber?: number;
}): Promise<DeliveryResult> {
    const results: string[] = [];
    const safePlayerName = sanitizePlayerName(params.playerName);
    const safeProductName = sanitizeRconArg(params.productName);
    const reference = params.reference ?? { kind: "manual" as const, id: null, label: params.productName };
    // One key per delivery and place, so a queue keeps a purchase's lines
    // together on each server and in the order the product lists them.
    const batch = reference.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const sequences = new Map<string, number>();

    const orderRef = sanitizeReference(params.orderNumber ?? batch);
    const lineNumber = params.lineNumber ?? 1;
    // Every unit's commands share the line's group, its sequence running on
    // from one unit to the next, so a queue keeps them whole and in order.
    const units = params.perUnit ? Math.max(1, Math.trunc(params.quantity || 1)) : 1;
    const runs = Array.from({ length: units }, (_, i) => params.commands.map((entry) => ({ entry, unit: i + 1 }))).flat();

    for (const { entry, unit } of runs) {
        let command = entry.command
            .replace(/\{player\}/g, safePlayerName)
            .replace(/\{product\}/g, safeProductName)
            .replace(/\{quantity\}/g, String(params.quantity || 1));

        if (params.variables) {
            for (const [key, value] of Object.entries(params.variables)) {
                command = command.replace(new RegExp(`\\{${key}\\}`, "g"), sanitizeRconArg(value));
            }
        }

        command = command
            .replace(/\{order\}/g, orderRef)
            .replace(/\{delivery\}/g, `${orderRef}-${lineNumber}-${unit}`)
            .replace(/\{unit\}/g, String(unit));

        const target = entry.target === "player" ? "player" : "server";
        const place = target === "player" ? "current" : (entry.serverId ?? "default");
        const groupKey = `${reference.kind}:${batch}:${params.line ?? "line"}:${place}`;
        const sequence = sequences.get(groupKey) ?? 0;
        sequences.set(groupKey, sequence + 1);

        const result = await runDeliveryCommand(command, entry.serverId, {
            target,
            whenOnline: entry.whenOnline ?? true,
            player: { name: safePlayerName, id: params.playerId ?? null, userId: params.userId ?? null },
            groupKey,
            sequence,
            reference: { ...reference, label: reference.label ?? params.productName },
        });

        if (!result.handled) {
            results.push("Error: no installed module can reach a game server");
            return { success: false, results };
        }
        if (!result.ok) {
            results.push(`Error: ${result.error ?? "the server refused the command"}`);
            return { success: false, results };
        }
        results.push(result.output ?? "");
    }

    return { success: true, results };
}
