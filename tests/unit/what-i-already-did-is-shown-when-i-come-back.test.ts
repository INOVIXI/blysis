import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * A screen shows what this reader already did, without being told again.
 *
 * Voting on a suggestion turned the button on. Coming back to the page turned
 * it off again - not because the vote had gone, but because the only thing
 * that ever set the button's state was the response to casting it. The state
 * started at `false` on every load, so the site's answer to "have I voted for
 * this" was "ask me by voting again", and voting again takes the vote away.
 *
 * The same shape was on the suggestion board and on a forum reply's like. A
 * topic's own like was read back correctly, which is why none of it looked
 * like one bug.
 *
 * The rule is read off the source because the failure is invisible: every one
 * of these screens works perfectly until the moment somebody reloads. A flag
 * a mutating request teaches the screen has to be a flag a read teaches it
 * too, or the screen only knows what happened while it was open.
 */

const ROOT = process.cwd();

/** POST, PATCH, PUT and DELETE: the requests that change something. */
const MUTATES = /method:\s*["'](POST|PUT|PATCH|DELETE)["']/;

/**
 * The file cut at the things that look like a function of its own.
 *
 * Crude on purpose. The question asked of a chunk is only "does this send a
 * write, and which setters does it call", and both survive a boundary drawn
 * in the wrong place: a chunk that is really two functions still answers yes
 * to the write, which makes the rule stricter rather than blinder.
 */
function chunks(source: string): string[] {
    const starts = [...source.matchAll(/(?:const\s+\w+\s*=\s*(?:useCallback\()?\s*async\s*\(|async\s+function\s+\w*\s*\(|function\s+\w+\s*\()/g)]
        .map((m) => m.index ?? 0);
    if (starts.length === 0) return [source];
    const out: string[] = [source.slice(0, starts[0])];
    for (let i = 0; i < starts.length; i++) {
        out.push(source.slice(starts[i], starts[i + 1] ?? source.length));
    }
    return out;
}

/**
 * `setLiked(data.liked)` - a yes-or-no this screen learned from a response.
 *
 * Both halves matter. The value has to be read off something rather than
 * typed - `setLiked(true)` is a screen deciding, not a screen being told -
 * and the state has to be a yes-or-no about this reader rather than a field
 * somebody is filling in, which is what the declaration below settles.
 */
const LEARNED = /\b(set[A-Z]\w*)\(\s*(?:Boolean\()?\s*(?!e\.|ev\.|evt\.|event\.)\w+\??\.\w+/g;

/** `const [liked, setLiked] = useState(false)` and the set-of-ids spelling. */
function yesOrNoStates(source: string): Set<string> {
    const found = new Set<string>();
    const DECLARED = /\[\s*\w+\s*,\s*(set[A-Z]\w*)\s*\]\s*=\s*useState\s*(?:<[^>]*>)?\s*\(\s*(false|true|new Set\()/g;
    for (const m of source.matchAll(DECLARED)) found.add(m[1]);
    return found;
}

interface OnlyWritten {
    where: string;
    setter: string;
}

function learnedOnlyByDoingItAgain(): OnlyWritten[] {
    const found: OnlyWritten[] = [];

    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules") walk(full);
                continue;
            }
            if (!/\.tsx$/.test(entry.name)) continue;

            const source = stripComments(fs.readFileSync(full, "utf8"));
            if (!MUTATES.test(source)) continue;

            const yesOrNo = yesOrNoStates(source);
            if (yesOrNo.size === 0) continue;

            const written = new Set<string>();
            const read = new Set<string>();
            for (const chunk of chunks(source)) {
                const target = MUTATES.test(chunk) ? written : read;
                for (const m of chunk.matchAll(LEARNED)) {
                    if (yesOrNo.has(m[1])) target.add(m[1]);
                }
            }

            for (const setter of written) {
                if (read.has(setter)) continue;
                found.push({ where: path.relative(ROOT, full), setter });
            }
        }
    };

    walk(path.join(ROOT, "module-sources"));
    walk(path.join(ROOT, "src/core/components"));
    walk(path.join(ROOT, "src/app"));
    return found.sort((a, b) => `${a.where}${a.setter}`.localeCompare(`${b.where}${b.setter}`));
}

/**
 * Setters a write really is the only source for, with the reason. These are
 * decisions; the list should shrink rather than grow.
 */
const ONLY_A_WRITE_KNOWS: Record<string, string> = {};

describe("what this reader already did", () => {
    const offenders = learnedOnlyByDoingItAgain();

    it("finds screens to check, so a broken scan cannot pass quietly", () => {
        const some = fs.readFileSync(
            path.join(ROOT, "module-sources/forum/components/TopicView.tsx"),
            "utf8",
        );
        expect(MUTATES.test(some)).toBe(true);
    });

    it("is read back on load, not only learned by doing it again", () => {
        const unexplained = offenders
            .filter(({ where, setter }) => !(`${where}:${setter}` in ONLY_A_WRITE_KNOWS))
            .map(({ where, setter }) => `${where}: ${setter}`);
        expect(unexplained).toEqual([]);
    });
});
