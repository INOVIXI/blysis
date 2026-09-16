import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source-text";

/**
 * A colour is the theme's to choose.
 *
 * The sign-in page painted its own: a `bg-blue-600` submit button over a
 * `bg-blue-50` two-factor box, `text-red-600` on a `bg-red-50` error, and a
 * back link that turned blue on hover. None of it moved when an operator
 * changed the theme, and none of it moved in dark mode either, because dark
 * here is `[data-mode="dark"]` on the root rather than Tailwind's `dark:`
 * variant. A palette colour is a fixed hex whatever else the site is doing.
 *
 * It mattered most where it was: sign in, register, the two password
 * screens and the verification page are the first thing a visitor sees of an
 * install, and a themed site showed them Tailwind's blue.
 *
 * The theme's own tokens are `primary`, `destructive`, `success`, `warning`,
 * `muted`, `border`, `card`, `foreground` and their `-foreground` pairs, each
 * redefined by every theme and by dark mode. An opacity suffix is how you get
 * a tint: `bg-primary/10` is the light blue box, `border-destructive/25` the
 * hairline round a warning.
 *
 * The existing colour gate does not catch these. It resolves a class against
 * the `--color-*` tokens the theme declares and fails on a name that is not
 * one - and `blue-500` is a perfectly real Tailwind colour. It is just not
 * ours.
 */

const ROOT = join(__dirname, "..", "..");

const TREES = ["src/app", "src/core", "module-sources"];

/**
 * Codegen, not source.
 *
 * A module's manifest may declare `color` for its dashboard card, documented
 * as "Tailwind color class e.g. text-red-500", and the registry generator
 * copies that through. Sixty-four of them arrive that way. Narrowing the
 * manifest to the theme's tones is a change to the grammar modules are
 * written against rather than a tidy up here, so it is a decision of its own.
 */
const CODEGEN = "src/core/generated/";

const PALETTE = [
    "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow",
    "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet",
    "purple", "fuchsia", "pink", "rose",
].join("|");

const UTILITY = [
    "bg", "text", "border", "from", "to", "via", "ring", "fill", "stroke",
    "decoration", "outline", "shadow", "accent", "caret", "divide", "placeholder",
].join("|");

/** `hover:bg-blue-600`, `md:text-red-500/50`, `bg-slate-900`. */
const HARDCODED = new RegExp(`\\b(?:${UTILITY})-(?:${PALETTE})-(?:50|[1-9]00|950)(?:/\\d+)?\\b`, "g");

function filesIn(dir: string, out: string[] = []): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(join(ROOT, dir), { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
            if (entry.name === "node_modules") continue;
            filesIn(rel, out);
        } else if (/\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
}

describe("a colour comes from the theme", () => {
    it("names no colour from the palette", () => {
        const offenders: string[] = [];
        for (const tree of TREES) {
            for (const file of filesIn(tree)) {
                if (file.startsWith(CODEGEN)) continue;
                const src = stripComments(fs.readFileSync(join(ROOT, file), "utf8"));
                for (const found of new Set(src.match(HARDCODED) ?? [])) {
                    offenders.push(`${file}: ${found}`);
                }
            }
        }
        expect(offenders, "use a theme token: primary, destructive, success, warning, muted").toEqual([]);
    });

    it("reads enough files for that to mean something", () => {
        expect(TREES.flatMap((tree) => filesIn(tree)).length).toBeGreaterThan(800);
    });
});
