// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { relativePath } from "./source-text";

/**
 * A document points only at what exists.
 *
 * The docs moved out of this repository once and came back. While they were
 * away, the README kept listing an SDK entry that had been removed, a module
 * count off by half, a contributing guide at a path that no longer existed,
 * and a "run this before you open a pull request" line that skipped most of
 * what CI runs. Nobody reads a link until they need it, so a stale one is
 * found by the person it fails.
 *
 * Every relative link, every repository path written in backticks and every
 * `npm run` script in the tracked Markdown must resolve, and a code fence
 * must close on a line of its own: one glued to the next sentence swallows
 * the rest of the page into the code block.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

/** Where a backticked word is a path into this repository rather than prose. */
const REPO_ROOTS = [
    ".github/",
    "docs/",
    "messages-core/",
    "module-marketplace/",
    "module-sources/",
    "module-template/",
    "prisma/",
    "scripts/",
    "src/",
    "tests/",
];

/** A placeholder (`<id>`, `NNN_*.sql`, `{a,b}`) names a shape, not a file. */
const PLACEHOLDER = /[<*{]|NNN/;

function documents(): string[] {
    const found = fs
        .readdirSync(ROOT)
        .filter((name) => name.endsWith(".md"))
        .concat("module-template/README.md", ".github/PULL_REQUEST_TEMPLATE.md")
        .concat(
            fs
                .readdirSync(path.join(ROOT, "module-sources"), { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .flatMap((entry) =>
                    fs
                        .readdirSync(path.join(ROOT, "module-sources", entry.name))
                        .filter((name) => name.endsWith(".md"))
                        .map((name) => `module-sources/${entry.name}/${name}`),
                ),
        );
    const visit = (dir: string) => {
        for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = `${dir}/${entry.name}`;
            // Gitignored: an agent's working drafts, not documentation.
            if (rel === "docs/superpowers") continue;
            if (entry.isDirectory()) visit(rel);
            else if (entry.name.endsWith(".md")) found.push(rel);
        }
    };
    visit("docs");
    visit(".claude/skills");
    return found.sort();
}

interface Prose {
    /** The text outside code fences, inline code removed. */
    prose: string;
    /** Inline code spans outside code fences. */
    spans: string[];
}

function split(text: string): Prose {
    const outside: string[] = [];
    let inFence = false;
    for (const line of text.split(/\r?\n/)) {
        if (/^\s*```/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (!inFence) outside.push(line);
    }
    const joined = outside.join("\n");
    return {
        prose: joined.replace(/`[^`\n]*`/g, ""),
        spans: [...joined.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]),
    };
}

/** GitHub's heading anchor: lower-case, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
    return heading
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .trim()
        .replace(/\s/g, "-");
}

function anchors(text: string): Set<string> {
    const { prose } = split(text.replace(/`([^`\n]*)`/g, "$1"));
    const headings = [...prose.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((m) => slug(m[1]));
    const ids = [...text.matchAll(/<a\s+id="([^"]+)"/g)].map((m) => m[1]);
    return new Set([...headings, ...ids]);
}

/** Every relative link in `text` (a document at `rel`) that resolves to nothing. */
function brokenLinks(rel: string, text: string, exists: (p: string) => string | null): string[] {
    const broken: string[] = [];
    for (const match of split(text).prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        const [file, anchor] = target.split("#");
        const resolved = file === "" ? rel : path.posix.normalize(path.posix.join(path.posix.dirname(rel), file));
        const body = exists(resolved);
        if (body === null) broken.push(`${rel}: ${target}`);
        else if (anchor && resolved.endsWith(".md") && !anchors(body).has(anchor)) broken.push(`${rel}: ${target} (no such heading)`);
    }
    return broken;
}

/** Every backticked repository path in `text` that names nothing. */
function missingPaths(rel: string, text: string, exists: (p: string) => string | null): string[] {
    return split(text)
        .spans.map((span) => span.split(/\s/)[0].replace(/:\d+$/, ""))
        .filter((word) => REPO_ROOTS.some((root) => word.startsWith(root)) && !PLACEHOLDER.test(word))
        .filter((word) => exists(word.replace(/\/$/, "")) === null)
        .map((word) => `${rel}: ${word}`);
}

/** Every `npm run <script>` in `text` that package.json does not define. */
function unknownScripts(rel: string, text: string, scripts: Set<string>): string[] {
    return [...text.matchAll(/npm run ([a-z][\w:-]*)/g)]
        .map((m) => m[1].replace(/[:-]+$/, ""))
        .filter((name) => !scripts.has(name))
        .map((name) => `${rel}: npm run ${name}`);
}

/** Every code fence with text after it that is not a language name. */
function gluedFences(rel: string, text: string): string[] {
    return text
        .split(/\r?\n/)
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /^\s*```/.test(line) && !/^\s*```[\w-]*\s*$/.test(line))
        .map(({ n }) => `${rel}:${n}`);
}

/** A file's text, "" for a directory, null for nothing. Read rather than stat'ed first, so there is no check to race. */
function onDisk(rel: string): string | null {
    try {
        return fs.readFileSync(path.join(ROOT, rel), "utf8");
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EISDIR") return "";
        if (code === "ENOENT" || code === "ENOTDIR") return null;
        throw err;
    }
}

const DOCS = documents();
const TEXT = new Map(DOCS.map((rel) => [rel, fs.readFileSync(path.join(ROOT, rel), "utf8")]));
const SCRIPTS = new Set(
    Object.keys((JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: object }).scripts),
);

describe("a tracked document", () => {
    it("is read from where the docs live", () => {
        expect(DOCS).toEqual(expect.arrayContaining(["AGENTS.md", "CONTRIBUTING.md", "README.md", "docs/README.md"]));
        expect(DOCS.filter((rel) => rel.startsWith("docs/")).length).toBeGreaterThan(5);
        expect(DOCS.every((rel) => relativePath(ROOT, path.join(ROOT, rel)) === rel)).toBe(true);
    });

    it("links only to files and headings that exist", () => {
        expect(DOCS.flatMap((rel) => brokenLinks(rel, TEXT.get(rel)!, onDisk))).toEqual([]);
    });

    it("names only repository paths that exist", () => {
        expect(DOCS.flatMap((rel) => missingPaths(rel, TEXT.get(rel)!, onDisk))).toEqual([]);
    });

    it("names only npm scripts that package.json defines", () => {
        expect(DOCS.flatMap((rel) => unknownScripts(rel, TEXT.get(rel)!, SCRIPTS))).toEqual([]);
    });

    it("closes every code fence on a line of its own", () => {
        expect(DOCS.flatMap((rel) => gluedFences(rel, TEXT.get(rel)!))).toEqual([]);
    });

    it("gives each check something to read", () => {
        const all = [...TEXT.values()].join("\n");
        expect([...split(all).prose.matchAll(/\]\(\.{0,2}\//g)].length).toBeGreaterThan(20);
        expect(split(all).spans.filter((s) => REPO_ROOTS.some((root) => s.startsWith(root))).length).toBeGreaterThan(20);
        expect([...all.matchAll(/npm run /g)].length).toBeGreaterThan(10);
    });
});

describe("the checks themselves", () => {
    const files: Record<string, string> = {
        "docs/a.md": "# Title\n\n## Agree on the problem first\n\n<a id=\"models\"></a>\n",
        "src/real.ts": "",
        "src/dir": "",
    };
    const fake = (p: string) => files[p] ?? null;

    it("refuse a link to a missing file and to a missing heading", () => {
        const text = "[a](./a.md) [b](./gone.md) [c](./a.md#agree-on-the-problem-first) [d](./a.md#nope) [e](#title) [f](a.md#models) [g](https://x.y/z)";
        expect(brokenLinks("docs/a.md", text, fake)).toEqual(["docs/a.md: ./gone.md", "docs/a.md: ./a.md#nope (no such heading)"]);
    });

    it("refuse a backticked path that names nothing, and pass a placeholder", () => {
        const text = "`src/real.ts` `src/dir/` `src/gone.ts --flag` `module-sources/<id>/` `prisma/migrations/NNN_x.sql` `apiSuccess`";
        expect(missingPaths("README.md", text, fake)).toEqual(["README.md: src/gone.ts"]);
    });

    it("ignore links and paths inside a code fence, and still read its scripts", () => {
        const text = "```bash\n[x](./gone.md) `src/gone.ts`\nnpm run nope\n```\n";
        expect(brokenLinks("README.md", text, fake)).toEqual([]);
        expect(missingPaths("README.md", text, fake)).toEqual([]);
        expect(unknownScripts("README.md", text, new Set(["dev"]))).toEqual(["README.md: npm run nope"]);
    });

    it("refuse a script package.json lacks", () => {
        expect(unknownScripts("README.md", "`npm run dev` then `npm run db:pushh`.", new Set(["dev", "db:push"]))).toEqual([
            "README.md: npm run db:pushh",
        ]);
    });

    it("refuse a fence glued to the sentence after it", () => {
        expect(gluedFences("x.md", "```bash\nnpm run dev\n``` The source of truth\n")).toEqual(["x.md:3"]);
        expect(gluedFences("x.md", "```bash\nnpm run dev\n```\n")).toEqual([]);
    });
});
