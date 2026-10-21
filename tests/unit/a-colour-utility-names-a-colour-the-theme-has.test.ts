import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { relativePath } from "./source-text";

/**
 * Tailwind does not warn about a colour that does not exist. It emits
 * nothing.
 *
 * The palette is declared in `globals.css` as `--color-primary`,
 * `--color-border` and so on. Write `border-input` - which is what shadcn's
 * own components say, and where several of these were copied from - and
 * Tailwind finds no `--color-input`, generates no rule, and the element falls
 * back to the CSS default `border-color: currentColor`. That is a near-black
 * hairline, on every textarea and every select on the site, sitting next to
 * inputs with a pale grey one. Nobody wrote "black"; the class silently did
 * nothing and black is what nothing looks like.
 *
 * Eleven classes were in that state: `border-input`, `ring-ring`,
 * `bg-popover`. This is the check that a twelfth is a failing test rather
 * than a screenshot.
 */

const ROOT = join(__dirname, "..", "..");
const ROOTS = ["src/app", "src/core", "src/themes", "module-sources"];

/** Colours the theme actually defines, read from the stylesheet. */
function themeColours(): Set<string> {
    const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
    return new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

/** Tailwind's own palette. Banned inside the panel by another gate, valid CSS everywhere. */
const PALETTE = new Set(
    [
        "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow",
        "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet",
        "purple", "fuchsia", "pink", "rose",
    ].flatMap((hue) => ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"].map((n) => `${hue}-${n}`)),
);

const KEYWORDS = new Set(["transparent", "current", "inherit", "white", "black"]);

/** Suffixes on these prefixes that are not colours at all. */
const NOT_A_COLOUR = new Set([
    // sizes
    "xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl", "none",
    // widths and offsets, which are bare numbers after a side is stripped
    "0", "1", "2", "3", "4", "5", "6", "7", "8",
    // a side on its own: `border-t`, `divide-y`, `border-x`
    "t", "b", "l", "r", "x", "y", "s", "e",
    // alignment and wrapping, on `text-`
    "left", "center", "right", "justify", "start", "end", "wrap", "nowrap", "balance", "pretty", "clip", "ellipsis",
    // border styles
    "solid", "dashed", "dotted", "double", "hidden",
    // where a ring is drawn, on `ring-`
    "inset",
    // gradients, on `bg-`
    "gradient-to-t", "gradient-to-tr", "gradient-to-r", "gradient-to-br",
    "gradient-to-b", "gradient-to-bl", "gradient-to-l", "gradient-to-tl",
    // backgrounds that are not colours
    "cover", "contain", "no-repeat", "repeat", "fixed", "local", "scroll",
    // outline
    "offset",
]);

const PREFIX = "(?:bg|text|border|ring|divide|outline|placeholder|caret|fill|stroke|from|via|to|decoration|shadow|accent)";
const CLASS = new RegExp(`^${PREFIX}-([a-z0-9]+(?:-[a-z0-9]+)*)$`);

/**
 * A colour can sit behind a side (`border-l-primary`) or behind `offset`
 * (`ring-offset-background`). Peel those off before looking the colour up.
 */
function colourPart(suffix: string): string {
    return suffix.replace(/^(?:[xytblrse]|se|ss|ee)-/, "").replace(/^offset-/, "");
}

/** Every string literal in a source file, with comments dropped. */
function stringLiterals(source: string): string {
    const out: string[] = [];
    for (let i = 0; i < source.length; ) {
        const c = source[i];
        if (c === "/" && source[i + 1] === "/") {
            const nl = source.indexOf("\n", i);
            i = nl < 0 ? source.length : nl;
        } else if (c === "/" && source[i + 1] === "*") {
            const close = source.indexOf("*/", i + 2);
            i = close < 0 ? source.length : close + 2;
        } else if (c === '"' || c === "'" || c === "`") {
            let j = i + 1;
            while (j < source.length && source[j] !== c) {
                if (source[j] === "\\") j++;
                j++;
            }
            out.push(source.slice(i + 1, j));
            i = j + 1;
        } else {
            i++;
        }
    }
    return out.join(" ");
}

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (name.endsWith(".tsx") || name.endsWith(".ts")) out.push(path);
    }
    return out;
}


/**
 * Class lists, grouped the way the browser will see them.
 *
 * A component often splits one element's classes across several strings
 * inside a `cn(...)` call - a base string, then a tone that supplies the
 * colour. Read separately the base looks like a border with no colour; read
 * together it is complete. So every literal inside one `cn(` call counts as
 * one list, and everything outside counts on its own.
 *
 * Anything holding a `${}` is skipped: the colour may be arriving through it.
 */
function classLists(source: string): string[] {
    const lists: string[] = [];
    const grouped = new Set<number>();

    for (let i = source.indexOf("cn("); i >= 0; i = source.indexOf("cn(", i + 3)) {
        let depth = 1;
        let j = i + 3;
        const parts: string[] = [];
        for (; j < source.length && depth > 0; j++) {
            const c = source[j];
            if (c === "(") depth++;
            else if (c === ")") depth--;
            else if (c === '"' || c === "'" || c === "`") {
                let k = j + 1;
                while (k < source.length && source[k] !== c) {
                    if (source[k] === "\\") k++;
                    k++;
                }
                parts.push(source.slice(j + 1, k));
                for (let m = j; m <= k; m++) grouped.add(m);
                j = k;
            }
        }
        lists.push(parts.join(" "));
    }

    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (source.startsWith("//", i)) {
            const nl = source.indexOf("\n", i);
            i = nl < 0 ? source.length : nl;
        } else if (source.startsWith("/*", i)) {
            const close = source.indexOf("*/", i + 2);
            i = close < 0 ? source.length : close + 1;
        } else if (c === '"' || c === "'" || c === "`") {
            let j = i + 1;
            while (j < source.length && source[j] !== c) {
                if (source[j] === "\\") j++;
                j++;
            }
            if (!grouped.has(i)) lists.push(source.slice(i + 1, j));
            i = j;
        }
    }
    return lists;
}

/** `border`, `border-2`, `divide-y`: a width with no colour beside it. */
const WIDTH_ONLY = /^(?:border|divide)(?:-[xytblrse])?(?:-(?:0|2|4|8))?$/;
const HAS_COLOUR = /^(?:border|divide)(?:-[xytblrse])?-(?!0$|2$|4$|8$|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing)/;

describe("a colour utility names a colour the theme has", () => {
    const known = new Set([...themeColours(), ...PALETTE, ...KEYWORDS]);

    it("reads the palette out of the stylesheet", () => {
        const colours = themeColours();
        expect(colours.has("primary")).toBe(true);
        expect(colours.has("border")).toBe(true);
        // The ones that were being written but never defined.
        expect(colours.has("input")).toBe(false);
        expect(colours.has("ring")).toBe(false);
    });

    it("emits a rule for every colour class in the codebase", () => {
        const offenders: string[] = [];
        for (const root of ROOTS) {
            for (const file of walk(join(ROOT, root))) {
                const text = stringLiterals(readFileSync(file, "utf8"));
                for (const raw of text.split(/[\s"'`{}()[\],;$]+/)) {
                    // strip variants (`hover:`, `md:`, `[&>svg]:`), `!`, and opacity
                    const token = raw.split(":").pop()!.replace(/^!/, "").split("/")[0];
                    const match = CLASS.exec(token);
                    if (!match) continue;
                    const colour = colourPart(match[1]);
                    if (known.has(colour) || NOT_A_COLOUR.has(colour) || NOT_A_COLOUR.has(match[1])) continue;
                    offenders.push(`${relativePath(ROOT, file)}: ${token}`);
                }
            }
        }
        expect([...new Set(offenders)]).toEqual([]);
    });
    it("gives every border a colour", () => {
        // Tailwind 4 changed the default border colour to `currentColor`, so
        // `border` on its own is not a light hairline any more - it is a
        // near-black stroke in whatever colour the text happens to be. The
        // rate-limits card had seventeen of these across the site; that was
        // the "black stroke" in the screenshot.
        const offenders: string[] = [];
        for (const root of ROOTS) {
            for (const file of walk(join(ROOT, root))) {
                if (relativePath(ROOT, file).includes("/generated/")) continue;
                for (const list of classLists(readFileSync(file, "utf8"))) {
                    if (list.includes("${")) continue;
                    const tokens = list.split(/\s+/).filter(Boolean).map((t) => t.split(":").pop()!);
                    // A one-word string is as likely to be a key called
                    // "border" as a class list, and a class list of exactly
                    // `border` has no layout to go with it anyway.
                    if (tokens.length < 2) continue;
                    const widths = tokens.filter((t) => WIDTH_ONLY.test(t));
                    if (widths.length === 0) continue;
                    if (tokens.some((t) => HAS_COLOUR.test(t))) continue;
                    offenders.push(`${relativePath(ROOT, file)}: ${widths.join(" ")}`);
                }
            }
        }
        expect([...new Set(offenders)]).toEqual([]);
    });
});
