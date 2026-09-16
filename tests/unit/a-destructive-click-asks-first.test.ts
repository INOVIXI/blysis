/**
 * Nothing is destroyed on one click without being asked about.
 *
 * The cart's "Clear Cart" button emptied it outright: an hour of picking
 * things out, gone to a misplaced pointer, with no undo and no basket left to
 * reconstruct it from. Unlinking a Discord or Minecraft account was the same
 * shape, and getting it back meant going through the provider again.
 *
 * The site already has one answer for this, `useConfirm`, and most screens
 * reach for it. This holds the rest to it: every DELETE a person can set off
 * has to pass through a confirmation somewhere in the function that sends it.
 *
 * A toggle is not a deletion, and one screen used to be exempt for that
 * reason: a permission matrix whose DELETE cleared a checkbox the next click
 * set again. Asking twice for something that undoes itself teaches people to
 * click through the question, which is what makes the dialog worthless where
 * it matters. That screen is gone, and the list of exemptions with it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "module-sources"];

/** Reversible by the same control that sent it. */
const TOGGLES = new Set<string>([]);

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === "generated") continue;
            if (full === path.join("src", "modules")) continue;
            walk(full, out);
        } else if (entry.name.endsWith(".tsx")) {
            out.push(full);
        }
    }
    return out;
}

/** The innermost braced block containing `index`. */
function enclosingBlock(source: string, index: number): string | null {
    let depth = 0;
    let start = -1;
    for (let i = index; i >= 0; i--) {
        if (source[i] === "}") depth++;
        else if (source[i] === "{") {
            if (depth === 0) { start = i; break; }
            depth--;
        }
    }
    if (start < 0) return null;
    depth = 0;
    for (let j = start; j < source.length; j++) {
        if (source[j] === "{") depth++;
        else if (source[j] === "}" && --depth === 0) return source.slice(start, j + 1);
    }
    return null;
}

/**
 * A call to the dialog, not the word.
 *
 * Matching `confirm` loosely made this gate vacuous: climbing out of the
 * request object reaches the component body, and the component body holds
 * `const { confirm } = useConfirm()` whether or not anything ever asks.
 */
const ASKS = /\bconfirm\s*\(/;

describe("a destructive click asks first", () => {
    const files = ROOTS.flatMap((root) => walk(root));

    it("has screens to check", () => {
        expect(files.length).toBeGreaterThan(350);
    });

    it("confirms before every DELETE a person can set off", () => {
        const silent: string[] = [];
        for (const file of files) {
            if (TOGGLES.has(file)) continue;
            const source = fs.readFileSync(file, "utf8");
            for (const sent of source.matchAll(/method:\s*"DELETE"/g)) {
                // Climb out of the request object to the function that sends it.
                let body = enclosingBlock(source, sent.index);
                for (let up = 0; up < 3 && body && !ASKS.test(body); up++) {
                    const at = source.indexOf(body);
                    if (at <= 0) break;
                    const wider = enclosingBlock(source, at - 1);
                    if (!wider || wider === body) break;
                    body = wider;
                }
                if (!body || !ASKS.test(body)) {
                    const line = source.slice(0, sent.index).split("\n").length;
                    silent.push(`${file}:${line}`);
                }
            }
        }
        expect(silent).toEqual([]);
    });
});
