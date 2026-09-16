import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source-text";

/**
 * A module reads its own tables, and asks for everything else.
 *
 * Modules never import each other, and the panel has a gate for that. The
 * merged Prisma client is the hole in it: every installed module's models sit
 * on one client, so a module can read another's tables without importing a
 * line of its code. Five did. The leaderboard queried the shop's `Order`, the
 * forum's `ForumPost` and the vote module's `VoteLog`, guarding each with a
 * "is this model here?" check - which is a module knowing the name of a table
 * it does not own and the shape of a feature it does not ship. Two invoicing
 * modules read `Order` the same way. The referral module wrote rows into the
 * shop's `CreditTransaction`.
 *
 * It is the wrong direction. A base module owns a concept and opens a socket;
 * the specific module plugs into it. The store already does this with
 * `server.command`: it asks whether anybody can run a command on a game
 * server, and the module that can answers. It does not know what RCON is.
 *
 * What a hook costs is a declaration; what a cross-module read costs is a
 * module that cannot be uninstalled without breaking another one, silently,
 * at runtime.
 *
 * Core's tables are not in scope: reaching core is what the SDK is for.
 */

const ROOT = join(__dirname, "..", "..");
const MODULES = "module-sources";

/**
 * Reads still to be turned into a hook, with the plan for each.
 *
 * It is empty. It held seven when this was written - the leaderboard's three,
 * the credit ledger's two and an order each for two invoicing modules - and
 * every one of them became a question the owning module answers. An addition
 * to it is a module reaching into another one, which is the thing this test
 * exists to stop.
 */
const STILL_REACHING: Record<string, string[]> = {};

function modelOwners(): Map<string, string> {
    const owners = new Map<string, string>();
    const declare = (file: string, owner: string) => {
        for (const line of fs.readFileSync(file, "utf8").split("\n")) {
            const model = /^model\s+(\w+)/.exec(line);
            if (model) owners.set(model[1], owner);
        }
    };
    declare(join(ROOT, "prisma/schema.core.prisma"), "core");
    for (const id of fs.readdirSync(join(ROOT, MODULES))) {
        const schema = join(ROOT, MODULES, id, "schema.prisma");
        if (fs.existsSync(schema)) declare(schema, id);
    }
    return owners;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, out);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
    }
    return out;
}

describe("a module owns what it reads", () => {
    const owners = modelOwners();
    /** `order` is `Order`; that is how Prisma names a delegate. */
    const delegates = new Map(
        [...owners].map(([model, owner]) => [model[0].toLowerCase() + model.slice(1), { model, owner }]),
    );

    const modules = fs
        .readdirSync(join(ROOT, MODULES), { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(join(ROOT, MODULES, e.name, "module.json")))
        .map((e) => e.name);

    it("has models and modules to check", () => {
        expect(owners.size).toBeGreaterThan(100);
        expect(modules.length).toBeGreaterThan(70);
    });

    it("touches no table another module declares", () => {
        const offenders: string[] = [];
        for (const id of modules) {
            const allowed = new Set(STILL_REACHING[id] ?? []);
            for (const file of sourceFiles(join(ROOT, MODULES, id))) {
                const src = stripComments(fs.readFileSync(file, "utf8"));
                // Three ways to reach a table: `prisma.order.findMany`, the
                // "is this model installed?" lookup a module writes when it
                // knows a name it should not, and the bracket form of either.
                // Nothing looser: `t("category")` is a translation key, and a
                // gate that reads it as the shop's Category table is a gate
                // nobody can trust.
                // `tx.` as well as `prisma.`: a write inside a transaction
                // reaches the same table by another name, and three modules
                // wrote to the shop's ledger that way without being seen.
                const named = [
                    ...src.matchAll(/\b(?:prisma|tx)\.(\w+)\./g),
                    ...src.matchAll(/\bprisma\s*(?:as[^)]*)?\)?\s*\[\s*["'](\w+)["']\s*\]/g),
                    ...src.matchAll(/\boptionalModel\s*[<(][^("']*["'](\w+)["']/g),
                ].map((m) => m[1]);
                for (const name of new Set(named)) {
                    const found = delegates.get(name);
                    if (!found || found.owner === "core" || found.owner === id) continue;
                    if (allowed.has(found.model)) continue;
                    offenders.push(`${id} reads ${found.model}, which ${found.owner} owns`);
                }
            }
        }
        expect([...new Set(offenders)], "ask through a hook the owning module answers").toEqual([]);
    });
});
