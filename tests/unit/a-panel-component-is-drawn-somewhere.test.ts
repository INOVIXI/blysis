// @vitest-environment node
/**
 * A screen's component is drawn by a screen.
 *
 * The dashboard used to carry the site's charts. They moved to a screen of
 * their own - Analytics - and the dashboard's copy was cut from the page and
 * left in the tree. Measured on 2026-09-20: `DashboardClient`,
 * `DashboardAnalytics` and `ModuleStatCards` were exported and rendered by
 * nothing, and behind them `dashboard-charts.tsx` drew the same "new users per
 * day" chart from the same `/api/v1/stats` endpoint the analytics screen
 * reads. Two implementations of one chart, one of them unreachable, and the
 * legacy wrapper's own comment said it was "still exported for components that
 * import it directly" - which nothing did.
 *
 * That is the cheapest kind of rot to leave and the most expensive to read: a
 * reader changing the chart has to work out which of the two is the live one,
 * and the answer is not in either file.
 *
 * Comments are stripped before the search. The first version of this scan did
 * not, and `DashboardClient` read as used because a comment in the very file
 * it was dead alongside mentioned it by name - the same trap
 * `a-gate-reads-the-whole-haystack` was written about.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

const ROOT = process.cwd();

/** Where the panel's own components live. */
const PANEL_TREES = [
    "src/app/[locale]/(admin)",
    "src/core/components/admin",
];

/**
 * A component nothing names, on purpose.
 *
 * Nothing is here. An entry would need a reason a reader can argue with - a
 * component a module renders by name through the registry, say - and the
 * moment one exists it belongs in this list rather than in somebody's memory.
 */
const DRAWN_ELSEWHERE: Record<string, string> = {};

function tsxFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules") tsxFiles(full, out);
        } else if (/\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

/** Every source file, because a panel component may be rendered from anywhere. */
const everything = tsxFiles(path.join(ROOT, "src"));
const code = new Map(everything.map((file) => [file, stripComments(fs.readFileSync(file, "utf8"))]));

const panelFiles = PANEL_TREES.flatMap((tree) => tsxFiles(path.join(ROOT, tree)));

/** `export function Name` - a component, by the capital. */
const EXPORTED = /export\s+(?:async\s+)?function\s+([A-Z]\w*)/g;

describe("a component the panel exports", () => {
    it("finds the panel, so a broken scan cannot pass quietly", () => {
        expect(panelFiles.length).toBeGreaterThan(50);
        expect(everything.length).toBeGreaterThan(panelFiles.length);
    });

    it("is named by something other than the file that exports it", () => {
        const orphans: string[] = [];
        for (const file of panelFiles) {
            const rel = path.relative(ROOT, file);
            const source = code.get(file) ?? stripComments(fs.readFileSync(file, "utf8"));
            for (const match of source.matchAll(EXPORTED)) {
                const name = match[1];
                if (`${rel}:${name}` in DRAWN_ELSEWHERE) continue;
                const named = [...code].some(
                    ([other, text]) => other !== file && new RegExp(`\\b${name}\\b`).test(text),
                );
                if (!named) orphans.push(`${rel}  ${name}`);
            }
        }
        expect(
            orphans,
            "These are exported and rendered by nothing. Delete them - git is the\n" +
            "archive - or name the file and component in DRAWN_ELSEWHERE with the\n" +
            `reason nothing can be seen to render it:\n${orphans.join("\n")}`,
        ).toEqual([]);
    });
});
