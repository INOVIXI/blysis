import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A response that arrives late must not overwrite a newer one.
 *
 * The pattern all over this codebase is an effect that fetches on a changing
 * dependency and writes the answer straight into state:
 *
 *     useEffect(() => {
 *         setLoading(true);
 *         fetch(`/api/v1/leaderboard?type=${activeTab}`)
 *             .then((r) => r.json())
 *             .then((d) => { setEntries(d.leaderboard); setLoading(false); });
 *     }, [activeTab]);
 *
 * Nothing here says which request the answer belongs to. Click tab A, then tab
 * B before A comes back, and A's rows land under B's heading and stay there
 * until something else re-renders the list. The stale `setLoading(false)` also
 * clears the spinner while B is still in flight, so the wrong data does not
 * even look like it is loading.
 *
 * Measured on the demo with the store page (deps `[activeCategory, activeMode,
 * sortBy]`), the forum index (`[selectedCategory, page, searchQuery]`) and the
 * leaderboard (`[activeTab]`): 36 effects across 33 files had no cancellation
 * at all. The two admin search boxes had a debounce timer, which stops a
 * keystroke landing *before* the request goes out and does nothing about one
 * landing after it.
 *
 * The fix is a flag the cleanup flips, checked before every state write. This
 * test fails if a new effect fetches on a dependency and writes state without
 * one.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["src/app", "src/core", "module-sources"];

interface Effect {
    file: string;
    line: number;
    body: string;
    deps: string;
}

/** Every `useEffect(() => { ... }, [deps])` in a file, body and deps intact. */
function effectsIn(file: string, source: string): Effect[] {
    const found: Effect[] = [];
    const opener = /useEffect\(\s*\(\s*\)\s*=>\s*\{/g;
    for (const match of source.matchAll(opener)) {
        const bodyStart = (match.index ?? 0) + match[0].length;
        let depth = 1;
        let i = bodyStart;
        for (; i < source.length && depth > 0; i++) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;
        }
        if (depth !== 0) continue;
        const body = source.slice(bodyStart, i - 1);
        const tail = source.slice(i, i + 400);
        const deps = /^\s*,\s*(\[[^\]]*\])/.exec(tail)?.[1] ?? "";
        found.push({
            file: path.relative(ROOT, file),
            line: source.slice(0, match.index ?? 0).split("\n").length,
            body,
            deps,
        });
    }
    return found;
}

function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.tsx$/.test(entry.name)) out.push(full);
    }
    return out;
}

function allEffects(): Effect[] {
    return SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d))).flatMap((f) =>
        effectsIn(f, fs.readFileSync(f, "utf8")),
    );
}

const SETTER = /\bset[A-Z]\w*\(/;

/**
 * An effect races if it fetches on a changing dependency and writes state with
 * what comes back. A `[]` dependency array runs once, so there is no second
 * request to be out of order with.
 */
function races(effect: Effect): boolean {
    if (effect.deps === "" || effect.deps === "[]") return false;
    const fetchAt = effect.body.indexOf("fetch(");
    if (fetchAt === -1) return false;
    return SETTER.test(effect.body.slice(fetchAt));
}

/**
 * A cleanup that either aborts the request or flips a flag the body reads.
 *
 * Matching the *word* `cancelled` anywhere would be enough to be fooled by a
 * `/* ignore *\/` comment, which is how the first pass at this fix skipped the
 * verify-email page. The flag has to be named by the cleanup and read above it.
 */
function cancels(effect: Effect): boolean {
    const at = effect.body.search(/return \(\) =>/);
    if (at === -1) return false;
    const cleanup = effect.body.slice(at);
    const before = effect.body.slice(0, at);
    if (/\.abort\(/.test(cleanup)) return true;
    const flip = /(\w+)\s*=\s*(?:true|false)\s*;/.exec(cleanup);
    if (!flip) return false;
    const uses = before.match(new RegExp(`\\b${flip[1]}\\b`, "g")) ?? [];
    return uses.length >= 2; // declared, and read at least once
}

/**
 * Effects that fetch on a dependency, write state, and cancel nothing, with
 * the reason recorded. Empty on purpose: an entry here is a race a reader can
 * hit, so it needs a reason a reader would accept.
 */
const RACES_BY_DESIGN: Record<string, string> = {};

describe("the scan", () => {
    const effects = allEffects();

    it("finds the effects at all", () => {
        expect(effects.length).toBeGreaterThan(150);
    });

    it("reads the dependency array, not just the body", () => {
        const withDeps = effects.filter((e) => e.deps !== "");
        expect(withDeps.length).toBeGreaterThan(100);
        expect(effects.some((e) => e.deps === "[]")).toBe(true);
    });

    it("counts the fetch-on-a-dependency effects this test is about", () => {
        expect(effects.filter(races).length).toBeGreaterThan(30);
    });
});

describe("an effect that fetches on a dependency", () => {
    it("drops a response for a dependency the user has already left", () => {
        const uncancelled = allEffects()
            .filter(races)
            .filter((e) => !cancels(e))
            .filter((e) => !(`${e.file}:${e.line}` in RACES_BY_DESIGN))
            .map((e) => `${e.file}:${e.line}`);
        expect(uncancelled).toEqual([]);
    });
});

describe("the pages this was found on", () => {
    const byFile = (file: string) =>
        effectsIn(file, fs.readFileSync(path.join(ROOT, file), "utf8")).filter(races);

    it("has no race left to lose on the store index", () => {
        // The category tabs were client state, each change firing its own
        // fetch, so a slow answer for the section a shopper had just left
        // could land on the one they were looking at. A section is an address
        // now and the server reads the shelf, so there is no request in flight
        // to arrive late.
        const source = fs.readFileSync(path.join(ROOT, "module-sources/store/pages/public/page.tsx"), "utf8");
        expect(source).not.toContain("useEffect");
        expect(source).not.toContain("fetch(");
        expect(byFile("module-sources/store/pages/public/page.tsx")).toEqual([]);
    });

    it("has no race left to lose on the forum index", () => {
        // The category, the page and the search used to be client state, each
        // firing its own fetch, and a slow answer for the section a reader had
        // just left would land on top of the one they were looking at. They
        // are addresses now: the server reads the board, so there is no
        // request in flight to arrive late.
        const source = fs.readFileSync(path.join(ROOT, "module-sources/forum/pages/public/page.tsx"), "utf8");
        expect(source).not.toContain("useEffect");
        expect(source).not.toContain("fetch(");
        expect(byFile("module-sources/forum/pages/public/page.tsx")).toEqual([]);
    });

    it("cancels on the leaderboard, where the tabs raced", () => {
        // The page reads the first board on the server now and renders the
        // tabs; the fetch that races is the tab switch, which is in them.
        const effects = byFile("module-sources/leaderboard/components/BoardTabs.tsx");
        // The tab is `activeId` since the boards became whatever the
        // installed modules offer; the race it guards is the same one.
        expect(effects.some((e) => e.deps.includes("activeId"))).toBe(true);
        expect(effects.every(cancels)).toBe(true);
    });

    it("cancels in the admin search box, where the debounce timer was not enough", () => {
        const source = fs.readFileSync(path.join(ROOT, "src/core/components/admin/AdminSearch.tsx"), "utf8");
        const effects = effectsIn("src/core/components/admin/AdminSearch.tsx", source).filter(races);
        expect(effects).toHaveLength(1);
        expect(cancels(effects[0])).toBe(true);
        // The timer has to survive the fix: without it every keystroke fetches.
        expect(effects[0].body).toContain("clearTimeout");
    });
});

describe("the detector itself", () => {
    const wrap = (body: string, deps: string): Effect => ({ file: "x.tsx", line: 1, body, deps });

    it("calls an uncancelled fetch-then-set a race", () => {
        expect(races(wrap(`fetch(url).then((d) => setRows(d));`, "[tab]"))).toBe(true);
        expect(cancels(wrap(`fetch(url).then((d) => setRows(d));`, "[tab]"))).toBe(false);
    });

    it("leaves a mount-only effect alone", () => {
        expect(races(wrap(`fetch(url).then((d) => setRows(d));`, "[]"))).toBe(false);
    });

    it("leaves an effect that fetches without writing state alone", () => {
        expect(races(wrap(`fetch(url).then(() => router.refresh());`, "[id]"))).toBe(false);
    });

    it("wants the cleanup, not just the word", () => {
        expect(cancels(wrap(`let cancelled = false; fetch(url).then((d) => { if (cancelled) return; setRows(d); });`, "[tab]"))).toBe(false);
    });

    it("is not fooled by a comment that happens to say ignore", () => {
        expect(
            cancels(wrap(`fetch(url).then((d) => { try { setRows(d); } catch { /* ignore */ } });`, "[tab]")),
        ).toBe(false);
    });

    it("wants the flag the cleanup flips to be read above it", () => {
        expect(
            cancels(wrap(`fetch(url).then((d) => setRows(d)); return () => { cancelled = true; };`, "[tab]")),
        ).toBe(false);
    });

    it("accepts a flag flipped by a cleanup", () => {
        expect(
            cancels(
                wrap(
                    `let cancelled = false; fetch(url).then((d) => { if (cancelled) return; setRows(d); }); return () => { cancelled = true; };`,
                    "[tab]",
                ),
            ),
        ).toBe(true);
    });

    it("accepts an AbortController", () => {
        expect(
            cancels(wrap(`const ac = new AbortController(); fetch(url, { signal: ac.signal }); return () => ac.abort();`, "[tab]")),
        ).toBe(true);
    });
});
