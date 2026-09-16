/**
 * The demo seeder's two rules, written down.
 *
 * A seed that runs before the data it hangs on writes rows with no parent, or
 * throws, and either way the site it was meant to fill is emptier than
 * before. The runner orders seeds by what each one says it needs; a circle
 * between them is a mistake nobody notices at three in the morning, so it is
 * an error rather than a hang or an arbitrary winner.
 *
 * The second rule is quieter: a module may name a need that this site has not
 * installed. That is not an error. The store seeds orders whether or not the
 * credits module is there, and a site chooses its own modules.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { ModuleSeed } from "@/core/sdk/seed";
import { inOrder } from "../../scripts/seed-demo";
import { stripComments } from "./source-text";

const seedOf = (needs?: string[]): ModuleSeed => ({ needs, run: async () => undefined });

describe("the order seeds run in", () => {
    it("puts a seed after the one it needs", () => {
        const order = inOrder(new Map([
            ["store", seedOf()],
            ["credits", seedOf(["store"])],
            ["leaderboard", seedOf(["credits", "store"])],
        ]));
        expect(order.indexOf("store")).toBeLessThan(order.indexOf("credits"));
        expect(order.indexOf("credits")).toBeLessThan(order.indexOf("leaderboard"));
    });

    it("runs every seed exactly once, however many name the same need", () => {
        const order = inOrder(new Map([
            ["store", seedOf()],
            ["a", seedOf(["store"])],
            ["b", seedOf(["store"])],
        ]));
        expect([...order].sort()).toEqual(["a", "b", "store"]);
    });

    it("ignores a need this site has not installed", () => {
        expect(inOrder(new Map([["store", seedOf(["credits"])]]))).toEqual(["store"]);
    });

    it("refuses a circle rather than picking a winner", () => {
        expect(() => inOrder(new Map([
            ["a", seedOf(["b"])],
            ["b", seedOf(["a"])],
        ]))).toThrow(/circle/i);
    });

    it("is the same order twice, so two runs write the same site", () => {
        const seeds = new Map([["c", seedOf()], ["a", seedOf()], ["b", seedOf(["a"])]]);
        expect(inOrder(seeds)).toEqual(inOrder(seeds));
    });
});

describe("the seeds the modules ship", () => {
    const SOURCES = path.join(process.cwd(), "module-sources");
    const seedFiles = fs.readdirSync(SOURCES)
        .map((id) => ({ id, file: path.join(SOURCES, id, "seed.ts") }))
        .filter(({ file }) => fs.existsSync(file));

    it("are there to be found", () => {
        expect(seedFiles.length).toBeGreaterThan(10);
    });

    it("each export a seed the runner can call", () => {
        // Checked as source rather than by importing: importing one pulls in
        // the generated Prisma client, which a unit test has no business
        // starting.
        const wrong: string[] = [];
        for (const { id, file } of seedFiles) {
            const source = fs.readFileSync(file, "utf8");
            if (!/export const seed: ModuleSeed = \{/.test(source)) wrong.push(`${id}: no exported seed`);
            if (!/run: async \(ctx\)/.test(source)) wrong.push(`${id}: seed has no run`);
        }
        expect(wrong).toEqual([]);
    });

    it("write through the context, so what they write can be taken back", () => {
        // A bare `ctx.prisma.x.create` leaves a row the ledger never heard of,
        // and `--clean` then leaves it behind. `upsert` and `update` are fine:
        // both may land on a row that was already there.
        const untracked: string[] = [];
        for (const { id, file } of seedFiles) {
            const source = stripComments(fs.readFileSync(file, "utf8"));
            for (const match of source.matchAll(/ctx\.prisma\.(\w+)\.create\(/g)) {
                const before = source.slice(Math.max(0, match.index! - 120), match.index!);
                if (!/ctx\.create\("\w+",\s*\(\)\s*=>\s*$/.test(before)) {
                    untracked.push(`${id}: ${match[1]}.create`);
                }
            }
        }
        expect(untracked).toEqual([]);
    });
});
