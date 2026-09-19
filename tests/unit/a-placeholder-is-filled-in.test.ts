import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * A message that names a value is given that value.
 *
 * `{username}` in a message is not text. It is an ICU argument, and next-intl
 * throws FORMATTING_ERROR when nothing supplies it - then renders the key
 * instead, so the reader gets `admin.broadcasts_usernamePlaceholder` on the
 * screen and the console gets a stack trace. Two of the screens on this list
 * failed that way and it read as two unrelated bugs.
 *
 * The two ways in are opposite mistakes:
 *
 *   - The sentence is *about* the token. "Use {username} to personalise it"
 *     wants the reader to see the braces, so the catalogue has to escape them:
 *     ICU reads `'{username}'` as the literal text. Writing them bare asks for
 *     a value that, by the nature of the sentence, does not exist.
 *   - The sentence wants a value and the call passes a different name. The
 *     gift code header declared `{count}` and was handed `total` and
 *     `available`, which is the same failure with a different cause.
 *
 * So the rule is read off both sides at once: resolve every `t("key")` to the
 * message it will format, and check the call supplies every argument that
 * message declares. Escaping is not special-cased - an escaped brace declares
 * no argument, which is the whole point of escaping it.
 */

const ROOT = process.cwd();

/** The ICU arguments a message declares, with `'{'` honoured as an escape. */
export function icuArguments(message: string): Set<string> {
    const found = new Set<string>();
    let depth = 0;

    for (let i = 0; i < message.length; i++) {
        const c = message[i];

        // In ICU an apostrophe quotes only when it precedes a brace; the
        // quoted run ends at the next apostrophe. `'{name}'` is literal text.
        if (c === "'" && (message[i + 1] === "{" || message[i + 1] === "}")) {
            const end = message.indexOf("'", i + 2);
            i = end === -1 ? message.length : end;
            continue;
        }

        if (c === "{") {
            if (depth === 0) {
                const name = /^\{\s*([A-Za-z0-9_]+)/.exec(message.slice(i));
                if (name) found.add(name[1]);
            }
            depth++;
        } else if (c === "}") {
            depth--;
        }
    }

    return found;
}

/** Every message the app can format, keyed `namespace.key`, per locale. */
function catalogue(): Map<string, Map<string, string>> {
    const out = new Map<string, Map<string, string>>();
    const add = (namespace: string, key: string, locale: string, text: string) => {
        const id = `${namespace}.${key}`;
        if (!out.has(id)) out.set(id, new Map());
        out.get(id)!.set(locale, text);
    };

    for (const locale of ["en", "tr"]) {
        const core = JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8"));
        for (const [namespace, block] of Object.entries(core)) {
            if (typeof block !== "object" || block === null) continue;
            for (const [key, text] of Object.entries(block as Record<string, unknown>)) {
                if (typeof text === "string") add(namespace, key, locale, text);
            }
        }
    }

    const modules = path.join(ROOT, "module-sources");
    for (const id of fs.readdirSync(modules)) {
        const file = path.join(modules, id, "module.json");
        if (!fs.existsSync(file)) continue;
        const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as {
            translations?: Record<string, Record<string, Record<string, string>>>;
        };
        for (const [locale, blocks] of Object.entries(manifest.translations ?? {})) {
            for (const [namespace, block] of Object.entries(blocks ?? {})) {
                for (const [key, text] of Object.entries(block ?? {})) {
                    if (typeof text === "string") add(namespace, key, locale, text);
                }
            }
        }
    }

    return out;
}

/** `src/modules` is an install of `module-sources`; scanning both double-reports. */
function sources(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name === "generated") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry.name)) out.push(full);
        }
    };
    walk(path.join(ROOT, "src/app"));
    walk(path.join(ROOT, "src/core"));
    walk(path.join(ROOT, "module-sources"));
    return out;
}

/** The call expression starting at `from`, read to its matching close paren. */
function callAt(source: string, from: number): string {
    let depth = 0;
    let quote: string | null = null;
    for (let i = from; i < source.length; i++) {
        const c = source[i];
        if (quote) {
            if (c === "\\") { i++; continue; }
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "(") depth++;
        else if (c === ")") { depth--; if (depth === 0) return source.slice(from, i + 1); }
    }
    return source.slice(from);
}

/**
 * The names supplied in the values object of a call. Both `{ total }` and
 * `{ total: rows.length }` name `total`, and a lookahead is what lets the
 * shorthand form be read - consuming the separator hides the name after it.
 */
function suppliedNames(call: string): Set<string> {
    const body = call.slice(call.indexOf(",") + 1);
    const names = new Set<string>();
    for (const m of body.matchAll(/(?<=[{,])\s*([A-Za-z0-9_]+)\s*(?=[,}:])/g)) names.add(m[1]);
    return names;
}

interface Unfilled {
    where: string;
    message: string;
    missing: string[];
}

function unfilled(): Unfilled[] {
    const messages = catalogue();
    const found: Unfilled[] = [];

    /** `const t = useTranslations("ns")` - the binding says which namespace. */
    const BINDING =
        /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*(?:\{[^}]*namespace:\s*)?["'`]([\w.]+)["'`]/g;

    for (const file of sources()) {
        const source = stripComments(fs.readFileSync(file, "utf8"));
        const bound = new Map<string, string>();
        for (const m of source.matchAll(BINDING)) bound.set(m[1], m[2]);
        if (bound.size === 0) continue;

        const names = [...bound.keys()].join("|");
        const CALL = new RegExp(`\\b(${names})(?:\\.rich)?\\(\\s*["'\`]([\\w.]+)["'\`]`, "g");

        for (const m of source.matchAll(CALL)) {
            const id = `${bound.get(m[1])}.${m[2]}`;
            const texts = messages.get(id);
            if (!texts) continue;

            const declared = new Set<string>();
            for (const text of texts.values()) for (const name of icuArguments(text)) declared.add(name);
            if (declared.size === 0) continue;

            // The match starts at the binding's name, so the first paren
            // after it opens this call - computing the offset from the match
            // length instead lands inside the key and finds a nested paren.
            const supplied = suppliedNames(callAt(source, source.indexOf("(", m.index!)));
            const missing = [...declared].filter((name) => !supplied.has(name));
            if (missing.length === 0) continue;

            found.push({
                where: `${path.relative(ROOT, file)}:${source.slice(0, m.index).split("\n").length}`,
                message: id,
                missing: missing.sort(),
            });
        }
    }

    return found;
}

describe("reading an ICU argument", () => {
    it("takes the name of a plain argument", () => {
        expect([...icuArguments("Page {page} of {pages}")]).toEqual(["page", "pages"]);
    });

    it("takes the name a plural is chosen by, and not its cases", () => {
        expect([...icuArguments("{count, plural, one {# item} other {# items}}")]).toEqual(["count"]);
    });

    it("reads an escaped brace as text, because that is what ICU does", () => {
        expect([...icuArguments("Use '{username}' to personalise it")]).toEqual([]);
    });

    it("does not treat an ordinary apostrophe as an escape", () => {
        expect([...icuArguments("Minecraft's {player} command")]).toEqual(["player"]);
    });
});

describe("a placeholder is filled in", () => {
    const offenders = unfilled();

    it("resolves calls to messages at all", () => {
        // A scan that resolves nothing passes for ever. There are thousands of
        // `t(...)` calls; if this ever drops, the binding regex stopped matching.
        const messages = catalogue();
        expect(messages.size).toBeGreaterThan(2000);
    });

    it("supplies every argument the message declares", () => {
        expect(offenders).toEqual([]);
    });

    it("declares the same arguments in both languages", () => {
        // A key added to one locale is added to both, and so is its argument.
        // A translator dropping `{count}` turns the English into a lie and the
        // Turkish into a formatting error only that locale can see.
        const drifted: string[] = [];
        for (const [id, texts] of catalogue()) {
            const en = texts.get("en");
            const tr = texts.get("tr");
            if (en === undefined || tr === undefined) continue;
            const a = [...icuArguments(en)].sort().join(",");
            const b = [...icuArguments(tr)].sort().join(",");
            if (a !== b) drifted.push(`${id}: en(${a || "-"}) tr(${b || "-"})`);
        }
        expect(drifted).toEqual([]);
    });
});

/** The tag names a rich message wraps text in: `<name>...</name>`. */
export function icuTags(message: string): Set<string> {
    const found = new Set<string>();
    for (const m of message.matchAll(/<([A-Za-z0-9_]+)>/g)) found.add(m[1]);
    return found;
}

/**
 * The values object of a call, as `name -> the expression written for it`.
 *
 * Read as text rather than parsed, because the only question asked of the
 * expression is whether it is a function, and that is visible on its face.
 */
export function valueExpressions(call: string): Map<string, string> {
    const out = new Map<string, string>();
    const open = call.indexOf("{", call.indexOf(","));
    if (open === -1) return out;

    let depth = 0;
    let quote: string | null = null;
    let start = open + 1;
    const entries: string[] = [];

    for (let i = open; i < call.length; i++) {
        const c = call[i];
        if (quote) {
            if (c === "\\") { i++; continue; }
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        // Angle brackets are deliberately not counted. A value is routinely
        // an arrow function, and the `>` of `=>` would close a depth nothing
        // opened - which read every correct call as a miscast one.
        if (c === "{" || c === "(" || c === "[") { depth++; continue; }
        if (c === "}" || c === ")" || c === "]") {
            depth--;
            if (depth === 0) { entries.push(call.slice(start, i)); break; }
            continue;
        }
        if (c === "," && depth === 1) { entries.push(call.slice(start, i)); start = i + 1; }
    }

    for (const entry of entries) {
        const colon = entry.indexOf(":");
        const name = (colon === -1 ? entry : entry.slice(0, colon)).trim();
        if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
        out.set(name, colon === -1 ? name : entry.slice(colon + 1).trim());
    }
    return out;
}

/** Written as a function: `(chunks) => ...`, `chunks => ...`, `() => ...`. */
function isFunction(expression: string): boolean {
    return /^(\([^)]*\)|[A-Za-z0-9_]+)\s*=>/.test(expression) || /^function\b/.test(expression);
}

interface Miscast {
    where: string;
    message: string;
    name: string;
    wanted: "a node" | "a function";
}

function miscastRichValues(): Miscast[] {
    const messages = catalogue();
    const found: Miscast[] = [];
    const BINDING =
        /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*(?:\{[^}]*namespace:\s*)?["'`]([\w.]+)["'`]/g;

    for (const file of sources()) {
        const source = stripComments(fs.readFileSync(file, "utf8"));
        const bound = new Map<string, string>();
        for (const m of source.matchAll(BINDING)) bound.set(m[1], m[2]);
        if (bound.size === 0) continue;

        const CALL = new RegExp(`\\b(${[...bound.keys()].join("|")})\\.rich\\(\\s*["'\`]([\\w.]+)["'\`]`, "g");
        for (const m of source.matchAll(CALL)) {
            const id = `${bound.get(m[1])}.${m[2]}`;
            const texts = messages.get(id);
            if (!texts) continue;

            const tags = new Set<string>();
            const args = new Set<string>();
            for (const text of texts.values()) {
                for (const tag of icuTags(text)) tags.add(tag);
                for (const arg of icuArguments(text)) args.add(arg);
            }

            const where = `${path.relative(ROOT, file)}:${source.slice(0, m.index).split("\n").length}`;
            for (const [name, expression] of valueExpressions(callAt(source, source.indexOf("(", m.index!)))) {
                if (tags.has(name) && !isFunction(expression)) found.push({ where, message: id, name, wanted: "a function" });
                if (!tags.has(name) && args.has(name) && isFunction(expression)) found.push({ where, message: id, name, wanted: "a node" });
            }
        }
    }
    return found;
}

describe("a rich message is given what its shape asks for", () => {
    /**
     * `t.rich` takes two different kinds of value and tells them apart by what
     * the message says, not by what was passed. `<name>text</name>` is a tag
     * and wants a function that receives the text it wraps; `{name}` is an
     * argument and wants the node itself. The theme library notice passed
     * `path: () => <code/>` for a `{path}` argument, so React was handed a
     * function as a child and refused to render the page.
     */
    it("finds rich calls to check", () => {
        expect(miscastRichValues).toBeTypeOf("function");
    });

    it("gives a tag a function and an argument a node", () => {
        expect(miscastRichValues()).toEqual([]);
    });
});
