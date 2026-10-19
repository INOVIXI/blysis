// @vitest-environment node
/**
 * Product delivery after this module stopped carrying its own RCON client.
 *
 * The store still owns the part that is genuinely its own - turning a command
 * template into a command line - and asks through the `server.command` filter
 * for someone to run it. What these tests pin down is the substitution, the
 * sanitising, and the three ways a delivery can end.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const applyFiltersAsync = vi.fn();
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: (...args: unknown[]) => applyFiltersAsync(...args) }));

const { deliverProduct } = await import("@/modules/store/lib/delivery");

const ran = () => applyFiltersAsync.mock.calls.map((call) => call[2] as { command: string; serverId: string | null });

function answers(...results: Array<{ handled: boolean; ok: boolean; output?: string; error?: string }>) {
    let i = 0;
    applyFiltersAsync.mockImplementation(async () => {
        const r = results[Math.min(i++, results.length - 1)];
        return { handled: r.handled, ok: r.ok, output: r.output ?? null, error: r.error ?? null };
    });
}

const ok = { handled: true, ok: true, output: "Done" };

beforeEach(() => {
    applyFiltersAsync.mockReset();
});

describe("deliverProduct", () => {
    it("substitutes the player, product and quantity into each command", async () => {
        answers(ok);
        await deliverProduct({
            playerName: "Notch",
            productName: "VIP Rank",
            quantity: 3,
            commands: [{ command: "give {player} {product} {quantity}" }],
        });
        expect(ran()[0].command).toBe("give Notch VIP Rank 3");
    });

    it("substitutes a product's own variables too", async () => {
        answers(ok);
        await deliverProduct({
            playerName: "Notch",
            productName: "Kit",
            commands: [{ command: "lp user {player} parent add {rank}" }],
            variables: { rank: "vip" },
        });
        expect(ran()[0].command).toBe("lp user Notch parent add vip");
    });

    // The substituted values land in a line a game server parses, so a player
    // name has to come out inert.
    it("strips anything that could turn one command into two", async () => {
        answers(ok);
        await deliverProduct({
            playerName: "evil; op evil",
            productName: "Rank",
            commands: [{ command: "give {player}" }],
        });
        expect(ran()[0].command).toBe("give evilopevil");
    });

    // A name is one argument. With its spaces kept, "Steve 999999" in
    // "eco give {player} 100" paid Steve 999999 and left the 100 over.
    it("keeps a player name one argument, however it was typed", async () => {
        answers(ok);
        await deliverProduct({
            playerName: "Steve 999999",
            productName: "Coins",
            commands: [{ command: "eco give {player} 100" }],
        });
        expect(ran()[0].command).toBe("eco give Steve999999 100");
    });

    it("sanitises custom variables as well as the built-in ones", async () => {
        answers(ok);
        await deliverProduct({
            playerName: "Notch",
            productName: "Kit",
            commands: [{ command: "lp user {player} parent add {rank}" }],
            variables: { rank: "vip; stop" },
        });
        expect(ran()[0].command).toBe("lp user Notch parent add vip stop");
    });

    it("sends each command to the server the product named", async () => {
        answers(ok);
        await deliverProduct({
            playerName: "Notch",
            productName: "Bundle",
            commands: [
                { command: "give {player} sword", serverId: "survival" },
                { command: "give {player} block", serverId: "creative" },
            ],
        });
        expect(ran().map((r) => r.serverId)).toEqual(["survival", "creative"]);
    });

    it("leaves the server unnamed when the product does not pick one", async () => {
        answers(ok);
        await deliverProduct({ playerName: "Notch", productName: "Kit", commands: [{ command: "give {player}" }] });
        expect(ran()[0].serverId).toBeNull();
    });

    it("reports success when every command lands", async () => {
        answers(ok);
        const result = await deliverProduct({
            playerName: "Notch",
            productName: "Bundle",
            commands: [{ command: "a" }, { command: "b" }],
        });
        expect(result).toEqual({ success: true, results: ["Done", "Done"] });
    });

    // Stopping matters: a half-delivered purchase the operator can see beats
    // one that silently ran two commands out of five.
    it("stops at the first command the server refuses", async () => {
        answers(ok, { handled: true, ok: false, error: "Unknown command" });
        const result = await deliverProduct({
            playerName: "Notch",
            productName: "Bundle",
            commands: [{ command: "a" }, { command: "b" }, { command: "c" }],
        });
        expect(result.success).toBe(false);
        expect(result.results).toEqual(["Done", "Error: Unknown command"]);
        expect(ran()).toHaveLength(2);
    });

    // A store with no game-server module installed is a different problem from
    // a server refusing a command, and has to read differently.
    it("says so when nothing on the install can reach a game server", async () => {
        answers({ handled: false, ok: false });
        const result = await deliverProduct({
            playerName: "Notch",
            productName: "Kit",
            commands: [{ command: "give {player}" }],
        });
        expect(result.success).toBe(false);
        expect(result.results[0]).toMatch(/no installed module can reach a game server/);
    });

    it("delivers nothing, successfully, when a product has no commands", async () => {
        answers(ok);
        await expect(
            deliverProduct({ playerName: "Notch", productName: "Cosmetic", commands: [] }),
        ).resolves.toEqual({ success: true, results: [] });
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });
});
