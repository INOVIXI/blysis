import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * A column an `orderBy` names has to exist on the model it orders.
 *
 * Neither typecheck catches this. Measured on 2026-09-07 by renaming a real
 * column to `unitsSoldXX` in the store's product list: `tsc --noEmit` exited 0,
 * `typecheck:modules` reported zero errors, `npm run build` succeeded, and the
 * running server answered every request to that endpoint with a 500 and
 * "Unknown argument". Prisma's `orderBy` takes a union that includes an array
 * form, and an object literal inside a ternary lands in it without the excess
 * property check ever firing.
 *
 * The same hole hides a staler problem. `prisma/schema.prisma` is merged from
 * the modules that are *installed* under `src/modules`, so a column added to a
 * module's source and not yet installed is missing from the client the gates
 * compile against - and the gates stay green while the app is broken. This
 * test reads the merged schema, which is the same file the client is generated
 * from, so it fails in exactly that situation too and says which column.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCANNED = ["src/app", "src/core", "module-sources"];

/** Model name (as Prisma's client spells it) to the fields it has. */
function modelFields(): Map<string, Set<string>> {
    const schema = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
    const models = new Map<string, Set<string>>();
    for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
        const [, name, body] = match;
        const fields = new Set<string>();
        for (const line of body.split("\n")) {
            const field = line.match(/^\s{2}(\w+)\s+\S/);
            if (field) fields.add(field[1]);
        }
        models.set(name[0].toLowerCase() + name.slice(1), fields);
    }
    return models;
}

/** Prisma's own ordering helpers, which are not columns. */
const NOT_A_COLUMN = new Set(["_count", "_avg", "_sum", "_min", "_max", "_relevance"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** The call expression starting at `from`, read to its matching close paren. */
function callAt(source: string, from: number): string {
    let depth = 0;
    for (let i = from; i < source.length; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")") {
            depth--;
            if (depth === 0) return source.slice(from, i + 1);
        }
    }
    return source.slice(from);
}

/**
 * Every key that names a column of the model being ordered.
 *
 * A key counts when exactly one brace is open: that is the first level of some
 * object literal in the expression, which is where this model's own columns
 * live. `{ conversation: { lastMessageAt: "desc" } }` orders by a relation, so
 * `conversation` counts and `lastMessageAt` belongs to the other model. An
 * array of literals and a ternary between several are both just more literals
 * at the same level, which is why this counts braces rather than parsing.
 */
function orderKeys(expression: string): string[] {
    const keys: string[] = [];
    let braces = 0;
    for (let i = 0; i < expression.length; i++) {
        const c = expression[i];
        if (c === "{") braces++;
        else if (c === "}") braces--;
        else if (braces === 1) {
            const key = /^(\w+)\s*:/.exec(expression.slice(i));
            const before = expression[i - 1];
            if (key && (before === "{" || before === "," || /\s/.test(before))) {
                keys.push(key[1]);
                i += key[0].length - 1;
            }
        }
    }
    return keys;
}

/**
 * The expression an `orderBy` at the top level of a call's argument is set to,
 * read to the comma that ends it. A nested one belongs to an `include` or a
 * `select`, which is a different model and not this call's to answer for.
 *
 * The expression rather than the literal, because the shape in this codebase
 * is often a ternary choosing between several orderings, and a version of this
 * test that only understood a literal read one of those as nothing at all and
 * passed on a column that did not exist.
 */
function topLevelOrderBy(call: string): string | null {
    let depth = 0;
    for (let i = 0; i < call.length; i++) {
        const c = call[i];
        if (c === "(" || c === "{" || c === "[") depth++;
        else if (c === ")" || c === "}" || c === "]") depth--;
        // depth 2 is inside the argument object of the call: `foo({ ... })`.
        else if (depth === 2 && call.startsWith("orderBy", i) && /[\s{,]/.test(call[i - 1] ?? "{")) {
            const rest = call.slice(i + "orderBy".length).replace(/^\s*:\s*/, "");
            let inner = 0;
            for (let j = 0; j < rest.length; j++) {
                const d = rest[j];
                if (d === "{" || d === "[" || d === "(") inner++;
                else if (d === "}" || d === "]" || d === ")") {
                    if (inner === 0) return rest.slice(0, j);
                    inner--;
                } else if (d === "," && inner === 0) return rest.slice(0, j);
            }
            return rest;
        }
    }
    return null;
}

/** Every `prisma.<model>.<op>(...)` call that orders by something. */
function orderedQueries(): { file: string; model: string; keys: string[] }[] {
    const found: { file: string; model: string; keys: string[] }[] = [];
    for (const dir of SCANNED) {
        for (const file of sourceFiles(path.join(ROOT, dir))) {
            const source = stripComments(fs.readFileSync(file, "utf8"));
            for (const match of source.matchAll(/\b(?:prisma|tx|db|client)\.(\w+)\.(findMany|findFirst|groupBy|aggregate)\s*\(/g)) {
                const call = callAt(source, match.index + match[0].length - 1);
                const expression = topLevelOrderBy(call);
                if (!expression) continue;
                const keys = orderKeys(expression);
                if (keys.length > 0) found.push({ file: path.relative(ROOT, file), model: match[1], keys });
            }
        }
    }
    return found;
}

describe("every orderBy in the tree", () => {
    const models = modelFields();

    it("reads a schema this test can actually see", () => {
        // A parse that silently found nothing would make everything below pass.
        expect(models.size).toBeGreaterThan(50);
        expect(models.get("product")).toContain("unitsSold");
    });

    it("names a column the model has", () => {
        const wrong: string[] = [];
        for (const query of orderedQueries()) {
            const fields = models.get(query.model);
            // A model this test cannot resolve is a variable named `db` or a
            // client from somewhere else; not this test's business.
            if (!fields) continue;
            for (const key of query.keys) {
                if (NOT_A_COLUMN.has(key)) continue;
                if (!fields.has(key)) wrong.push(`${query.file}: ${query.model}.${key}`);
            }
        }
        expect(wrong, "an orderBy naming a column the model does not have answers 500 at runtime").toEqual([]);
    });
});
