import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * A screen may not invent a value the module it belongs to has no word for.
 *
 * Twice now, one module has held two vocabularies for the same column. The
 * punishments admin form stored six types while its public page filtered on
 * four, one of them spelled differently, so the Warning filter matched nothing
 * an admin had ever created. The suggestions board filtered on `under_review`,
 * `accepted` and `rejected` while the schema accepted `underReview`, `planned`
 * and `declined`, so three of its filter buttons always came back empty and
 * its badge labelled a declined suggestion "Open".
 *
 * Both were invisible: a filter that matches nothing looks exactly like a
 * filter with nothing to match. So once a module declares its vocabulary, the
 * screens have to use it. Any list of string literals inside a module that
 * overlaps a declared vocabulary must be drawn from it.
 */

const MODULES = path.resolve(__dirname, "../../module-sources");

/** A module's declared vocabulary for a column: the values it may hold. */
const DECLARES_A_VOCABULARY = () =>
    /export const (\w*(?:STATUSES|TYPES|STATES))\s*=\s*\[([^\]]*)\]\s*as const/g;

/**
 * A literal list of strings, the shape a screen's filter row is written in.
 *
 * Matched in two steps, and deliberately.
 *
 * It used to be one pattern - `(?:\s*"[^"]*"\s*,?)+` - which nests three
 * quantifiers over overlapping whitespace, so an unclosed bracket followed by
 * a run of quoted words backtracked exponentially and hung the scanner rather
 * than failing it. Widening it to "anything between brackets" removes the
 * nesting and the narrowness with it: it then swept up arrays of objects,
 * which is most of what a screen's source actually contains.
 *
 * So the bracket is found by a pattern that cannot backtrack, and whether the
 * contents are a flat list of quoted strings is decided by a scan.
 */
const BRACKETED = () => /\[([^\]]*)\]/g;

/** True when the text between brackets is only quoted strings and commas. */
function isFlatStringList(body: string): boolean {
    const withoutStrings = body.replace(/"[^"]*"/g, "");
    return body.includes('"') && /^[\s,]*$/.test(withoutStrings);
}

/**
 * Sentinels that stand for the absence of a filter rather than for a value the
 * column can hold. The empty string is one; so is the "all" beside it.
 */
const SENTINELS = new Set(["", "all"]);

/** Case and punctuation carry no meaning when comparing two spellings. */
function fold(raw: string): string {
    return raw.trim().toLowerCase().replace(/[^a-z]/g, "");
}

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

const MODULE_IDS = fs
    .readdirSync(MODULES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

interface Stray {
    file: string;
    list: string[];
    stray: string[];
}

function straysIn(moduleId: string): Stray[] {
    const files = sourceFiles(path.join(MODULES, moduleId));
    const sources = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

    const vocabulary = new Set<string>();
    for (const source of sources.values()) {
        for (const [, , body] of source.matchAll(DECLARES_A_VOCABULARY())) {
            /*
             * A vocabulary written as rows rather than as a flat list.
             *
             * `DEFAULT_STATUSES` is an array of objects now - a key, a
             * translation key, a tone, two flags - and reading every quoted
             * string in it put the tones into the column's vocabulary. The
             * list of tones beside it then overlapped by four of five and the
             * fifth was reported as a value the column may not hold. The
             * column's values are the keys.
             */
            const rows = body.includes("{")
                ? [...body.matchAll(/\bkey:\s*"([^"]+)"/g)].map((m) => m[1])
                : [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
            for (const value of rows) vocabulary.add(fold(value));
        }
    }
    if (vocabulary.size === 0) return [];

    const found: Stray[] = [];
    for (const [file, source] of sources) {
        for (const [, body] of source.matchAll(BRACKETED())) {
            if (!isFlatStringList(body)) continue;
            const values = [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
            const meaningful = values.filter((v) => !SENTINELS.has(fold(v)));
            // A list that shares nothing with the vocabulary is about
            // something else entirely.
            if (!meaningful.some((v) => vocabulary.has(fold(v)))) continue;
            const stray = meaningful.filter((v) => !vocabulary.has(fold(v)));
            if (stray.length > 0) {
                found.push({ file: path.relative(MODULES, file), list: values, stray });
            }
        }
    }
    return found;
}

describe("a screen draws its values from its module's vocabulary", () => {
    it("finds the modules that declare one", () => {
        const declaring = MODULE_IDS.filter((id) =>
            sourceFiles(path.join(MODULES, id)).some(
                (f) => DECLARES_A_VOCABULARY().exec(fs.readFileSync(f, "utf8")) !== null,
            ),
        );
        expect(declaring.length).toBeGreaterThan(0);
    });

    for (const moduleId of MODULE_IDS) {
        it(`${moduleId} names no value its vocabulary does not hold`, () => {
            const strays = straysIn(moduleId);
            const report = strays.map((s) => `${s.file}: ${s.stray.join(", ")} in [${s.list.join(", ")}]`);
            expect(report, report.join("\n")).toEqual([]);
        });
    }
});
