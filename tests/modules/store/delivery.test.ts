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

// A command that hands out a fixed amount delivered one unit to somebody who
// paid for three, and a game plugin that refuses a repeated payment had no
// reference to refuse it by.
describe("deliverProduct, unit by unit", () => {
    const sent = () =>
        applyFiltersAsync.mock.calls.map((call) => call[2] as { command: string; delivery: { groupKey: string; sequence: number } });

    it("runs the list once per line when the product does not ask for more", async () => {
        answers(ok);
        await deliverProduct({
            playerName: "Notch",
            productName: "Bonus",
            quantity: 3,
            commands: [{ command: "townyadmin givebonus {player} 8" }],
        });
        expect(ran().map((r) => r.command)).toEqual(["townyadmin givebonus Notch 8"]);
    });

    it("runs the whole list once per unit, in order, in one group", async () => {
        answers(ok);
        await deliverProduct({
            playerName: "Notch",
            productName: "Rank",
            quantity: 3,
            perUnit: true,
            commands: [{ command: "a {unit}" }, { command: "b {unit}" }],
            reference: { kind: "order", id: "o1", label: "Rank" },
            line: "line-1",
        });
        expect(sent().map((r) => r.command)).toEqual(["a 1", "b 1", "a 2", "b 2", "a 3", "b 3"]);
        expect(new Set(sent().map((r) => r.delivery.groupKey))).toEqual(new Set(["order:o1:line-1:default"]));
        expect(sent().map((r) => r.delivery.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("stops at the first unit a server refuses", async () => {
        answers(ok, { handled: true, ok: false, error: "Unknown command" });
        const result = await deliverProduct({
            playerName: "Notch",
            productName: "Rank",
            quantity: 3,
            perUnit: true,
            commands: [{ command: "a {unit}" }],
        });
        expect(result.success).toBe(false);
        expect(ran()).toHaveLength(2);
    });

    it("names the order, the run and the unit", async () => {
        answers(ok);
        await deliverProduct({
            playerName: "Notch",
            productName: "Rank",
            quantity: 2,
            perUnit: true,
            orderNumber: "ORD-MH3K2-AB12",
            lineNumber: 2,
            commands: [{ command: "lp user {player} parent addtemp karamel 30d accumulate {order} {delivery} {unit}" }],
        });
        expect(ran().map((r) => r.command)).toEqual([
            "lp user Notch parent addtemp karamel 30d accumulate ORD-MH3K2-AB12 ORD-MH3K2-AB12-2-1 1",
            "lp user Notch parent addtemp karamel 30d accumulate ORD-MH3K2-AB12 ORD-MH3K2-AB12-2-2 2",
        ]);
    });

    // A retried delivery repeats its reference, so a plugin can refuse it.
    it("gives a retried delivery the same reference", async () => {
        answers(ok);
        const once = { playerName: "Notch", productName: "Rank", quantity: 1, orderNumber: "ORD-1", lineNumber: 1, commands: [{ command: "x {delivery} {unit}" }] };
        await deliverProduct(once);
        await deliverProduct(once);
        expect(ran().map((r) => r.command)).toEqual(["x ORD-1-1-1 1", "x ORD-1-1-1 1"]);
    });

    it("keeps a reference one argument of letters, digits and dashes", async () => {
        answers(ok);
        await deliverProduct({
            playerName: "Notch",
            productName: "Rank",
            orderNumber: "ORD 1;op x",
            commands: [{ command: "x {order} {delivery}" }],
        });
        expect(ran()[0].command).toBe("x ORD1opx ORD1opx-1-1");
    });

    // A checkout's answers are the buyer's words. The store's own placeholders
    // carry the order number a game plugin pays once against, so no answer
    // may stand in for one, whatever it is called.
    it("never lets a buyer's answer stand in for a placeholder the store fills", async () => {
        answers(ok);
        await deliverProduct({
            playerName: "Notch",
            productName: "Kit",
            quantity: 1,
            orderNumber: "ORD-1",
            commands: [{ command: "pay {player} {product} {quantity} {order} {delivery} {unit}" }],
            variables: { player: "x", product: "x", quantity: "64", order: "x 999", delivery: "x", unit: "9" },
        });
        expect(ran()[0].command).toBe("pay Notch Kit 1 ORD-1 ORD-1-1-1 1");
    });

    it("delivers whatever a variable is called", async () => {
        answers(ok);
        const result = await deliverProduct({
            playerName: "Notch",
            productName: "Kit",
            commands: [{ command: "kit {colour}" }],
            variables: { "(": "x", colour: "red" },
        });
        expect(result.success).toBe(true);
        expect(ran()[0].command).toBe("kit red");
    });
});
