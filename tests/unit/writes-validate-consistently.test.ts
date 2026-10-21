import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A model is usually written from more than one handler: one route creates the
 * row, another edits it. When only one of those handlers parses a schema, the
 * schema is decoration. Whatever the guarded door refuses can be walked in
 * through the unguarded one, and the bounds the author thought they had set -
 * a length cap, a required field, a shape - hold for exactly half the traffic.
 *
 * That is not a hypothetical. The forum bounded a reply at 50000 characters on
 * create and wrote the edit straight from the body, so any authenticated user
 * could blank their own post with an empty PATCH or store far more than the cap.
 * Popups was the same defect mirrored: the edit parsed a schema, the create did
 * not.
 *
 * The rule below is deliberately narrow so it stays true rather than merely
 * loud. It only complains when, inside one module, a model is written by a
 * handler that parses a schema AND by a handler that puts request-body fields
 * into the write without parsing anything. A handler that writes only
 * server-computed values (a vote counter, a credit ledger entry) is not asked
 * to validate a body it never reads.
 */

const ROOT = path.resolve(__dirname, "../..");
// `tx` is the same client inside a transaction, and writes the same rows.
const WRITE = /\b(?:prisma|tx)\.(\w+)\.(create|createMany|update|updateMany|upsert)\s*\(/g;
const GUARD = /\.(safeParse|parse)\(/;
const BODY_BINDING = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:readJsonBody|request\.json|req\.json)\b/g;
const HANDLER = /export async function (GET|POST|PATCH|PUT|DELETE)\b/g;

type Handler = { verb: string; body: string };
type Write = { module: string; file: string; verb: string; model: string; guarded: boolean; usesBody: boolean };

function splitHandlers(source: string): Handler[] {
    const starts: { at: number; verb: string }[] = [];
    for (const m of source.matchAll(HANDLER)) starts.push({ at: m.index, verb: m[1] });
    return starts.map((s, i) => ({
        verb: s.verb,
        body: source.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : source.length),
    }));
}

/** The text of the call that begins at `from`, balanced across nested braces. */
function callText(source: string, from: number): string {
    const open = source.indexOf("(", from);
    if (open === -1) return "";
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        const c = source[i];
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") {
            depth--;
            if (depth === 0) return source.slice(open, i + 1);
        }
    }
    return source.slice(open);
}

function bodyNames(handler: string): string[] {
    const names = [...handler.matchAll(BODY_BINDING)].map((m) => m[1]);
    return names.length > 0 ? names : ["body"];
}

function referencesBody(call: string, names: string[]): boolean {
    return names.some((n) => new RegExp(`\\b${n}\\.\\w`).test(call) || new RegExp(`\\.\\.\\.\\s*${n}\\b`).test(call));
}

export function writesIn(owner: string, file: string, source: string): Write[] {
    const found: Write[] = [];
    for (const handler of splitHandlers(source)) {
        if (handler.verb === "GET" || handler.verb === "DELETE") continue;
        const names = bodyNames(handler.body);
        const guarded = GUARD.test(handler.body);
        for (const m of handler.body.matchAll(WRITE)) {
            const call = callText(handler.body, m.index);
            found.push({
                module: owner,
                file,
                verb: handler.verb,
                model: m[1],
                guarded,
                usesBody: referencesBody(call, names),
            });
        }
    }
    return found;
}

/** Handlers writing a model that some other handler in the same module validates. */
export function asymmetricWrites(writes: Write[]): Write[] {
    const groups = new Map<string, Write[]>();
    for (const w of writes) {
        const key = `${w.module}::${w.model}`;
        groups.set(key, [...(groups.get(key) ?? []), w]);
    }
    const bad: Write[] = [];
    for (const group of groups.values()) {
        if (!group.some((w) => w.guarded)) continue;
        for (const w of group) if (!w.guarded && w.usesBody) bad.push(w);
    }
    return bad;
}

function routeFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.name === "node_modules") continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name === "route.ts") out.push(full);
        }
    };
    if (fs.existsSync(dir)) walk(dir);
    return out;
}

function collect(): Write[] {
    const writes: Write[] = [];
    for (const base of ["module-sources", "src/app/api"]) {
        for (const file of routeFiles(path.join(ROOT, base))) {
            const rel = path.relative(ROOT, file);
            const owner = base === "module-sources" ? rel.split(path.sep)[1] : "core";
            writes.push(...writesIn(owner, rel, fs.readFileSync(file, "utf8")));
        }
    }
    return writes;
}

describe("a model's write paths validate together or not at all", () => {
    const writes = collect();

    it("finds write handlers to check", () => {
        expect(writes.length).toBeGreaterThan(100);
        expect(writes.some((w) => w.guarded)).toBe(true);
    });

    it("has no handler pushing raw body fields into a model another handler validates", () => {
        const bad = asymmetricWrites(writes);
        const report = bad.map((w) => `${w.file} ${w.verb} -> prisma.${w.model}`).join("\n");
        expect(report).toBe("");
    });

    it("validates both of the forum post write paths", () => {
        const posts = writes.filter((w) => w.module === "forum" && w.model === "forumPost");
        expect(posts.length).toBeGreaterThan(1);
        for (const w of posts) expect(w.guarded, `${w.file} ${w.verb}`).toBe(true);
    });

    it("validates both of the popup write paths against one shared schema", () => {
        const popups = writes.filter((w) => w.module === "popups" && w.model === "popup");
        expect(popups.length).toBe(2);
        for (const w of popups) expect(w.guarded, `${w.file} ${w.verb}`).toBe(true);
        const create = fs.readFileSync(path.join(ROOT, "module-sources/popups/api/route.ts"), "utf8");
        const update = fs.readFileSync(path.join(ROOT, "module-sources/popups/api/[id]/route.ts"), "utf8");
        expect(create).toContain('from "../lib/validations"');
        expect(update).toContain('from "../../lib/validations"');
    });
});

describe("the asymmetry check itself", () => {
    const guarded = `
export async function POST(request: NextRequest) {
    const body = await readJsonBody(request);
    const parsed = thingSchema.safeParse(body);
    await prisma.thing.create({ data: { name: parsed.data.name } });
}
`;
    const raw = `
export async function PATCH(request: NextRequest) {
    const body = await readJsonBody(request);
    await prisma.thing.update({ where: { id }, data: { name: body.name } });
}
`;
    const computed = `
export async function POST(request: NextRequest) {
    const body = await readJsonBody(request);
    await prisma.thing.update({ where: { id }, data: { votes: { increment: 1 } } });
}
`;

    it("catches the unguarded half of a model's write paths", () => {
        const writes = [...writesIn("m", "a.ts", guarded), ...writesIn("m", "b.ts", raw)];
        expect(asymmetricWrites(writes).map((w) => w.file)).toEqual(["b.ts"]);
    });

    it("says nothing when no handler for the model validates", () => {
        expect(asymmetricWrites(writesIn("m", "b.ts", raw))).toEqual([]);
    });

    it("leaves a server-computed write alone", () => {
        const writes = [...writesIn("m", "a.ts", guarded), ...writesIn("m", "c.ts", computed)];
        expect(asymmetricWrites(writes)).toEqual([]);
    });

    it("does not mix two modules that happen to share a model name", () => {
        const writes = [...writesIn("one", "a.ts", guarded), ...writesIn("two", "b.ts", raw)];
        expect(asymmetricWrites(writes)).toEqual([]);
    });

    it("sees a write made inside a transaction", () => {
        const inTransaction = `
export async function PATCH(request: NextRequest) {
    const body = await readJsonBody(request);
    await prisma.$transaction(async (tx) => {
        await tx.thing.update({ where: { id }, data: { name: body.name } });
    });
}
`;
        const writes = [...writesIn("m", "a.ts", guarded), ...writesIn("m", "t.ts", inTransaction)];
        expect(asymmetricWrites(writes).map((w) => w.file)).toEqual(["t.ts"]);
    });

    it("reads a write call across nested braces rather than to the first one", () => {
        const nested = `
export async function POST(request: NextRequest) {
    const body = await readJsonBody(request);
    await prisma.thing.create({ data: { meta: { deep: true }, name: body.name } });
}
`;
        expect(writesIn("m", "n.ts", nested)[0].usesBody).toBe(true);
    });
});
