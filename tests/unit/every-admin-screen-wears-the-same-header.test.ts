import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source-text";

/**
 * One title row, one set of proportions.
 *
 * Eighty admin screens had written their own. The heading came in twelve
 * sizes: `text-3xl font-bold` on fifty-one, `text-xl font-semibold` on
 * twenty-five, `text-lg font-medium` on one. The row was `items-center mb-8`
 * here and `items-start mb-6` there, so the action button beside the title
 * sat at a different height and a different distance from the table below.
 * The way back out of a create form was a top-right outline button on one
 * screen, an icon-only ghost button on another, and a bare `← Back to
 * Articles` link - in English, on a Turkish page - on a third.
 *
 * `AdminPageHeader` is the row. These are the two rules that keep it one.
 *
 * A screen that is not a page - an error card, a fixed toolbar - is not
 * covered here, and does not pretend to be a page header.
 */

const ROOT = join(__dirname, "..", "..");

const ADMIN_TREES = [
    "src/app/[locale]/(admin)",
    "src/core/components/admin",
    ...listModuleAdminDirs(),
];

function listModuleAdminDirs(): string[] {
    try {
        return execFileSync("sh", ["-c", "ls -d module-sources/*/pages/admin 2>/dev/null"], {
            cwd: ROOT,
            encoding: "utf8",
        })
            .split("\n")
            .filter(Boolean);
    } catch {
        return [];
    }
}

function grep(pattern: string, paths: string[]): string[] {
    if (paths.length === 0) return [];
    try {
        return execFileSync("grep", ["-rn", "--include=*.tsx", pattern, ...paths], {
            cwd: ROOT,
            encoding: "utf8",
        })
            .split("\n")
            .filter(Boolean);
    } catch {
        return [];
    }
}

/** Screens that are deliberately not a page with a title row. */
const NOT_A_PAGE = [
    // The header itself.
    "src/core/components/admin/AdminPageHeader.tsx",
    // A full-screen editor with a fixed toolbar, not a scrolling page.
    "module-sources/custom-pages/pages/admin/builder/",
    // The admin error boundary: a card in the middle of the screen.
    "src/app/[locale]/(admin)/error.tsx",
];

/** Every .tsx under the given trees, repo-relative. */
function tsxFilesIn(trees: string[]): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(join(ROOT, dir), { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const path = `${dir}/${entry.name}`;
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith(".tsx")) out.push(path);
        }
    };
    for (const tree of trees) walk(tree);
    return out.sort();
}

/**
 * Comments are prose about the code, not the code. The header component's own
 * doc comment spells out what an action looks like, and a gate that reads it
 * as a real button would fail on the documentation of the rule it enforces.
 */

/** Character ranges of each `pattern`'s balanced `{...}` value. */
function braceRanges(src: string, pattern: RegExp): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const match of src.matchAll(pattern)) {
        let depth = 0;
        for (let i = match.index! + match[0].length - 1; i < src.length; i++) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}" && --depth === 0) {
                out.push([match.index!, i]);
                break;
            }
        }
    }
    return out;
}

/** Each `<Tag ...>` opening tag, as the span of the tag itself. */
function openTags(src: string, tag: string): Array<{ start: number; end: number }> {
    const out: Array<{ start: number; end: number }> = [];
    for (const match of src.matchAll(new RegExp(`${tag}\\b`, "g"))) {
        let depth = 0;
        let quote = "";
        let i = match.index! + match[0].length;
        for (; i < src.length; i++) {
            const c = src[i];
            if (quote) {
                if (c === quote) quote = "";
            } else if (c === '"' || c === "'") quote = c;
            else if (c === "{") depth++;
            else if (c === "}") depth--;
            else if (c === ">" && depth === 0) break;
        }
        out.push({ start: match.index!, end: i + 1 });
    }
    return out;
}

/** Is there an opening `tag` before here that has not been closed yet? */
function unclosed(before: string, open: string, close: string): boolean {
    return before.split(open).length > before.split(close).length;
}

describe("every admin screen wears the same header", () => {
    it("leaves the page title to AdminPageHeader", () => {
        const offenders = grep("<h1", ADMIN_TREES).filter(
            (line) => !NOT_A_PAGE.some((allowed) => line.startsWith(allowed)),
        );
        expect(offenders).toEqual([]);
    });

    it("puts no icon in the title", () => {
        // Two screens out of eighty drew a lucide icon to the left of their
        // title. On every other screen the title is words, so the two with a
        // glyph read as a different kind of page for no reason - and the
        // theme screen's palette icon sat at a size nothing else used.
        // Every `title={...}`, whatever it is wrapped in. Written against
        // `title={<>` alone this missed the one that used `title={<span>`,
        // and a screen kept its icon for another two months.
        const offenders: string[] = [];
        for (const file of tsxFilesIn(ADMIN_TREES)) {
            if (NOT_A_PAGE.some((allowed) => file.startsWith(allowed))) continue;
            const src = stripComments(fs.readFileSync(join(ROOT, file), "utf8"));
            for (const [start, end] of braceRanges(src, /\btitle=\{/g)) {
                const title = src.slice(start, end);
                // A lucide icon is `<Name className="w-4 h-4" />`: an element
                // whose name is capitalised and that sizes itself in w-/h-.
                if (/<[A-Z]\w*\s[^>]*className="[^"]*\bw-\d/.test(title)) {
                    offenders.push(`${file}:${src.slice(0, start).split("\n").length}`);
                }
            }
        }
        expect(offenders, "a title is words; put the icon in the sidebar entry").toEqual([]);
    });

    it("keeps the way back with the actions, not on a line of its own", () => {
        const header = fs.readFileSync(join(ROOT, "src/core/components/admin/AdminPageHeader.tsx"), "utf8");
        // The back control used to be rendered above the title row, which
        // pushed the heading down the page and left the whole top right
        // corner of a create form empty.
        const row = header.slice(header.indexOf("return ("));
        const cluster = row.indexOf("{back}");
        const heading = row.indexOf("<h1");
        expect(cluster, "back belongs in the right hand cluster").toBeGreaterThan(heading);
        expect(row).toContain("items-center");
    });

    it("gives the primary action one size and one place", () => {
        // "Yeni Ceza" was `size="sm"` in a filter row; "Yeni Ceza" on the
        // servers screen next door was a full-size button in the header. Same
        // control, two sizes, two places, depending on which screen you had
        // open. A create action is a link to a create screen, so that is what
        // this looks for: a <Link> wrapping a <Button> with a Plus in it.
        //
        // Two placements are right. The header's action slot is the normal
        // one. An empty state may repeat the same button inside its card,
        // because there is no list to point at yet. Anything else is a screen
        // inventing its own spot, and `size` on any of them is a screen
        // inventing its own proportions.
        const offenders: string[] = [];
        for (const file of tsxFilesIn(ADMIN_TREES)) {
            if (NOT_A_PAGE.some((allowed) => file.startsWith(allowed))) continue;
            const src = stripComments(fs.readFileSync(join(ROOT, file), "utf8"));
            const slots = braceRanges(src, /actions=\{/g);
            for (const button of openTags(src, "<Button")) {
                const body = src.slice(button.end).split("</Button>")[0];
                if (!body.includes("<Plus")) continue;
                if (!/<Link\s[^>]*href=[^>]*>\s*$/.test(src.slice(0, button.start))) continue;
                const inHeader = slots.some(([a, b]) => a < button.start && button.start < b);
                const inCard = unclosed(src.slice(0, button.start), "<CardContent", "</CardContent>");
                const where = `${file}:${src.slice(0, button.start).split("\n").length}`;
                if (!inHeader && !inCard) offenders.push(`${where} is not in the header or an empty state`);
                else if (/\ssize=/.test(src.slice(button.start, button.end))) offenders.push(`${where} sets its own size`);
            }
        }
        expect(offenders, "a create action is a header action, at the size every screen gives it").toEqual([]);
    });

    it("gives the save one place too", () => {
        // The theme's Hero screen put its save alone in a right-aligned row
        // between the header and the card, with the header's own right hand
        // side left empty - one click from the Appearance screen, which puts
        // the same button in the header. Across the panel the same control
        // was in the header on five screens, under the last card on seven,
        // full width at the bottom of a card on two, and floating on three.
        //
        // A save is a page action when the page is one form: it goes in the
        // header. It stays inside a <Card> only when it saves that card
        // rather than the screen - a settings block on a page that also shows
        // something else, or a create form among a list. Loose between the
        // two is what this forbids.
        const offenders: string[] = [];
        for (const file of tsxFilesIn(ADMIN_TREES)) {
            if (NOT_A_PAGE.some((allowed) => file.startsWith(allowed))) continue;
            const src = stripComments(fs.readFileSync(join(ROOT, file), "utf8"));
            if (!src.includes("<AdminPageHeader")) continue;
            const slots = braceRanges(src, /actions=\{/g);
            for (const button of openTags(src, "<Button")) {
                const body = src.slice(button.end).split("</Button>")[0];
                // The label, not the handler: `saveDraft` and `saveSettings`
                // are both saves, `saved` is the state after one.
                if (!/\bt\("[a-zA-Z_]*[Ss]av(e|ing)[a-zA-Z_]*"/.test(body)) continue;
                const before = src.slice(0, button.start);
                if (slots.some(([a, b]) => a < button.start && button.start < b)) continue;
                // `<Card` as plain text also matches `<CardContent`, which
                // would let a loose button pass on any screen that had ever
                // opened one. Count the element, not the prefix.
                const opened = before.match(/<Card\b/g)?.length ?? 0;
                const closed = before.match(/<\/Card>/g)?.length ?? 0;
                if (opened > closed) continue;
                offenders.push(`${file}:${before.split("\n").length}`);
            }
        }
        expect(offenders, "a save belongs in the header, or inside the card it saves").toEqual([]);
    });

    it("is mounted widely enough for that to mean something", () => {
        expect(grep("<AdminPageHeader", ADMIN_TREES).length).toBeGreaterThan(60);
    });
});
