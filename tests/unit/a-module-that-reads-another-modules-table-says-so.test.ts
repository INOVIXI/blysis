import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const SOURCES = path.join(ROOT, "module-sources");

/**
 * A module that cannot run without another one says so in its manifest.
 *
 * The platform already has the mechanism: `dependencies` in `module.json`,
 * which `module-dependencies.ts` checks at install and enable time and
 * `install-plan.ts` walks to pull the closure in. What nothing checked was
 * whether the list matched what the code actually does.
 *
 * It did not. The wheel module debited `user.creditBalance` and wrote a
 * `CreditTransaction` row, both of which the store module contributes to the
 * schema, and minted a `Coupon`, which the store owns outright. It declared a
 * dependency on `credits`, and `credits` declared none at all - while reading
 * that same ledger table itself. Installing either without the store left a
 * spin, a credit grant and a credit history page that threw on a Prisma client
 * with no such model, at the moment a person used them rather than at the
 * moment an operator installed them.
 *
 * What counts as needing another module, for this gate:
 *
 *  - Calling into a model it owns: `prisma.coupon.create`, `tx.order.findMany`.
 *  - Naming a field it contributes to a core model inside a Prisma query:
 *    `prisma.user.update({ data: { creditBalance: ... } })`. The `User` model
 *    is core's, but half its columns arrive from modules.
 *
 * What does not, deliberately: reading such a field back off a result and
 * tolerating its absence. `member-profiles` shows an order count, a topic
 * count and a suggestion count on a profile and filters out whichever ones
 * came back undefined, which is a module working with or without its
 * neighbours rather than depending on them. This gate cannot tell that shape
 * from a careless read, so it does not judge either; the reads it does judge
 * are the ones where absence is a crash.
 */

const modules = fs
    .readdirSync(SOURCES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

function read(p: string): string {
    return fs.readFileSync(p, "utf8");
}

/** `model Foo {` in a schema, and the module that declares it. */
function modelOwners(): Map<string, string> {
    const owners = new Map<string, string>();
    for (const id of modules) {
        const schema = path.join(SOURCES, id, "schema.prisma");
        if (!fs.existsSync(schema)) continue;
        for (const match of read(schema).matchAll(/^model\s+(\w+)/gm)) {
            owners.set(match[1], id);
        }
    }
    return owners;
}

/** The columns a module adds to core's `User`, and which module adds them. */
function contributedUserFields(): Map<string, string> {
    const fields = new Map<string, string>();
    for (const id of modules) {
        const schema = path.join(SOURCES, id, "schema.prisma");
        if (!fs.existsSync(schema)) continue;
        const block = /@@user-relations-start([\s\S]*?)@@user-relations-end/.exec(read(schema));
        if (!block) continue;
        for (const line of block[1].split("\n")) {
            const field = /^\s*\/\/\s*(\w+)\s+\S/.exec(line);
            if (field) fields.set(field[1], id);
        }
    }
    return fields;
}

const CORE_MODELS = new Set(
    [...read(path.join(ROOT, "prisma/schema.core.prisma")).matchAll(/^model\s+(\w+)/gm)].map(
        (m) => m[1],
    ),
);

/** The balanced `(...)` that starts at or after `from`. */
function callArguments(source: string, from: number): string {
    const open = source.indexOf("(", from);
    if (open === -1) return "";
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")" && --depth === 0) return source.slice(open, i + 1);
    }
    return source.slice(open);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

const OWNERS = modelOwners();
const CONTRIBUTED = contributedUserFields();

/** Prisma's client property for a model: `CreditTransaction` -> `creditTransaction`. */
const clientName = new Map<string, string>(
    [...OWNERS.keys()].map((model) => [model[0].toLowerCase() + model.slice(1), model]),
);

/** Which modules a module needs, read from what its code does. */
function neededModules(id: string): Map<string, Set<string>> {
    const needs = new Map<string, Set<string>>();
    const note = (owner: string, what: string) => {
        if (owner === id) return;
        if (!needs.has(owner)) needs.set(owner, new Set());
        needs.get(owner)!.add(what);
    };

    for (const file of sourceFiles(path.join(SOURCES, id))) {
        const source = read(file);

        for (const match of source.matchAll(/\b(?:prisma|tx)\.([a-z]\w*)\./g)) {
            const model = clientName.get(match[1]);
            if (!model || CORE_MODELS.has(model)) continue;
            const owner = OWNERS.get(model);
            if (owner) note(owner, model);
        }

        for (const match of source.matchAll(/\b(?:prisma|tx)\.user\.\w+/g)) {
            const args = callArguments(source, match.index + match[0].length);
            for (const [field, owner] of CONTRIBUTED) {
                if (new RegExp(`\\b${field}\\b`).test(args)) note(owner, `User.${field}`);
            }
        }
    }
    return needs;
}

/** Everything an install of `id` pulls in, following declarations transitively. */
function declaredClosure(id: string): Set<string> {
    const seen = new Set<string>();
    const queue = [id];
    while (queue.length > 0) {
        const current = queue.shift()!;
        const manifest = path.join(SOURCES, current, "module.json");
        if (!fs.existsSync(manifest)) continue;
        const declared: string[] = JSON.parse(read(manifest)).dependencies ?? [];
        for (const spec of declared) {
            // A spec is `id` or `id@range`; only the id matters here.
            const dependency = spec.split("@")[0];
            if (seen.has(dependency)) continue;
            seen.add(dependency);
            queue.push(dependency);
        }
    }
    return seen;
}

describe("the scan itself", () => {
    it("found the schemas it reads ownership from", () => {
        expect(OWNERS.size).toBeGreaterThan(50);
        expect(CONTRIBUTED.size).toBeGreaterThan(20);
        expect(CORE_MODELS.size).toBeGreaterThan(20);
    });

    it("knows who owns the credit ledger and the user's balance", () => {
        // Both moved to the module named after them, and four modules stopped
        // writing either: they ask `credit.change` and hand over their
        // transaction. See `a-module-owns-what-it-reads`, which is the
        // stricter rule this one grew into.
        expect(OWNERS.get("CreditTransaction")).toBe("credits");
        expect(CONTRIBUTED.get("creditBalance")).toBe("credits");
    });
});

describe("every module declares what its code needs", () => {
    it.each(modules)("%s", (id) => {
        const needs = neededModules(id);
        if (needs.size === 0) return;
        const closure = declaredClosure(id);
        const missing = [...needs.entries()]
            .filter(([owner]) => !closure.has(owner))
            .map(([owner, what]) => `${owner} (for ${[...what].sort().join(", ")})`);
        expect(missing, `${id} uses these without declaring them`).toEqual([]);
    });
});

describe("the modules this gate was written for", () => {
    it("the wheel declares the store, whose coupons and ledger it writes", () => {
        expect([...declaredClosure("wheel")]).toContain("store");
    });

    it("the shop declares the credits module, whose wallet it spends", () => {
        // The dependency turned round with the ledger: the shop sells things
        // for credits, and the module that keeps them is what it needs.
        expect([...declaredClosure("store")]).toContain("credits");
    });

    it("the CSV export declares the store, whose column it writes into a row", () => {
        expect([...declaredClosure("csv-import-export")]).toContain("store");
    });
});
