// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * Starting something new looks the same everywhere in the panel.
 *
 * It did not. Most screens put a plus beside the word; one wrote the plus as
 * text in the label - `+ New article` - and an empty state's call to action
 * had nothing at all. Three spellings of one idea, which is the kind of thing
 * a person notices without being able to say why the panel feels unfinished.
 *
 * The rule is about what a control does, not where it sits. A control that
 * *starts* a creation wears the plus, whether it opens a form on another
 * screen or submits an inline one from a list. A control that *finishes* a
 * form on a screen already titled "New X" does not: the plus would be saying
 * a second time what the heading above it already says.
 *
 * And the plus is an icon, never a character in the label: a `+` typed into
 * text cannot be translated around, sits on the wrong baseline, and is read
 * aloud by a screen reader as "plus".
 */

const ROOT = process.cwd();

function screens(): { file: string; body: string; onNewScreen: boolean }[] {
    const roots = [
        path.join(ROOT, "src/app/[locale]/(admin)/admin"),
        ...fs
            .readdirSync(path.join(ROOT, "module-sources"), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(ROOT, "module-sources", entry.name, "pages/admin"))
            .filter((dir) => fs.existsSync(dir)),
    ];

    const out: { file: string; body: string; onNewScreen: boolean }[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".tsx")) {
                out.push({
                    file: path.relative(ROOT, full),
                    body: stripComments(fs.readFileSync(full, "utf8")),
                    onNewScreen: /\/(new|create)(\/|$)/.test(path.dirname(full)),
                });
            }
        }
    };
    for (const root of roots) walk(root);
    return out;
}

const SCREENS = screens();
const CONTROL = /<(Link|Button|button)\b[\s\S]{0,600}?<\/\1>/g;
const PLUS_ICON = /<(Plus|PlusCircle|UserPlus|FilePlus|CirclePlus)\b/;

describe("a control that starts something new", () => {
    it("has admin screens to read", () => {
        expect(SCREENS.length).toBeGreaterThan(80);
    });

    it("wears a plus, everywhere", () => {
        const bare: string[] = [];
        for (const screen of SCREENS) {
            for (const [control] of screen.body.matchAll(CONTROL)) {
                const opens = /href=[^>]*?(new|create)/i.test(control) && !control.includes('type="submit"');
                if (opens && !PLUS_ICON.test(control)) bare.push(screen.file);
            }
        }
        expect([...new Set(bare)]).toEqual([]);
    });

    it("wears it as an icon, not as a character in the label", () => {
        const typed: string[] = [];
        for (const screen of SCREENS) {
            for (const [control] of screen.body.matchAll(CONTROL)) {
                // `+ ${t("...")}` and `{"+ New"}`: a plus that is text.
                if (/[`"'{]\s*\+\s+[$\w{]/.test(control)) typed.push(screen.file);
            }
        }
        expect([...new Set(typed)]).toEqual([]);
    });
});

describe("a control that finishes a form", () => {
    it("does not repeat the plus the heading already made", () => {
        const noisy: string[] = [];
        for (const screen of SCREENS) {
            if (!screen.onNewScreen) continue;
            for (const [control] of screen.body.matchAll(CONTROL)) {
                if (control.includes('type="submit"') && PLUS_ICON.test(control)) noisy.push(screen.file);
            }
        }
        expect([...new Set(noisy)]).toEqual([]);
    });
});
