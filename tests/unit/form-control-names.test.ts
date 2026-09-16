/**
 * A visible label the browser knows nothing about is not a label.
 *
 * A hundred and fifty controls across forty-one screens sat under a
 * `<label>` or `<Label>` that carried no `htmlFor` and wrapped nothing, next
 * to an `<Input>` that carried no `id` and no `aria-label`. The text was
 * there on screen and the association was not, so a screen reader announced
 * "edit text, blank" for the whole of the SEO settings, the site settings,
 * the role editor, the warning form, the setup wizard, the store's coupon
 * and category screens, the cart's player-name field and the product page's
 * per-variable inputs. Twelve labels in the same codebase did it correctly,
 * so the rule was known and simply not applied.
 *
 * A control is named by any of: `aria-label`, `aria-labelledby`, an `id` a
 * label points at with `htmlFor`, or a `<label>` that wraps it. This gate
 * takes the last two as given and looks for the case that has none of them:
 * a label immediately followed by an unnamed control.
 *
 * `aria-label` is what the fix used rather than `htmlFor`/`id`, because a
 * third of these sit inside a `.map()` where one id would be emitted once
 * per row. `htmlFor` stays welcome wherever the control is not in a list.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const SCANNED = ["src/app", "src/core/components", "module-sources"];
const CONTROL = /<(input|textarea|select|Input|Textarea|Select)\b/;

function tsxFiles(dir: string, out: string[] = []): string[] {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === "node_modules") continue;
            tsxFiles(full, out);
        } else if (entry.endsWith(".tsx")) out.push(full);
    }
    return out;
}

/** Index of the `>` that closes the tag opening at `start`, skipping braces and strings. */
function tagEnd(source: string, start: number): number {
    let depth = 0;
    let quote: string | null = null;
    for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (quote) {
            if (c === quote && source[i - 1] !== "\\") quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) return i;
    }
    return -1;
}

function unnamedControlsUnderALabel(file: string): string[] {
    const source = readFileSync(file, "utf8");
    const found: string[] = [];
    let i = source.search(/<[Ll]abel\b/);

    while (i !== -1) {
        const end = tagEnd(source, i);
        const open = source.slice(i, end + 1);
        const lower = source.indexOf("</label>", end);
        const upper = source.indexOf("</Label>", end);
        const close = lower === -1 ? upper : upper === -1 ? lower : Math.min(lower, upper);

        // A label with htmlFor, or one that wraps its own control, is done.
        if (close !== -1 && !/htmlFor/.test(open) && !CONTROL.test(source.slice(end + 1, close))) {
            const after = source.slice(close + 8, close + 8 + 400);
            const match = after.match(CONTROL);
            if (match) {
                // Another component between the two is the thing being
                // labelled; this control is somebody else's.
                const gap = after.slice(0, match.index);
                if (!/<[A-Z][A-Za-z]*\b/.test(gap)) {
                    const ci = close + 8 + (match.index as number);
                    const tag = source.slice(ci, tagEnd(source, ci) + 1);
                    // A control inside its own wrapping label is already named.
                    const before = source.slice(0, ci);
                    const open2 = Math.max(before.lastIndexOf("<label"), before.lastIndexOf("<Label"));
                    const c1 = before.indexOf("</label>", open2);
                    const c2 = before.indexOf("</Label>", open2);
                    const wrapped = open2 !== -1 && !((c1 !== -1 && c1 < ci) || (c2 !== -1 && c2 < ci));
                    if (!wrapped && !/\bid=/.test(tag) && !/aria-label|aria-labelledby/.test(tag)) {
                        const line = source.slice(0, i).split("\n").length;
                        found.push(`${file.slice(ROOT.length + 1)}:${line}`);
                    }
                }
            }
        }
        const next = source.slice(i + 1).search(/<[Ll]abel\b/);
        i = next === -1 ? -1 : i + 1 + next;
    }
    return found;
}

describe("form controls", () => {
    const files = SCANNED.flatMap((d) => tsxFiles(join(ROOT, d))).filter(
        (f) => !f.includes("/src/modules/"),
    );

    it("scans the app, the shared components and every module", () => {
        expect(files.length).toBeGreaterThan(100);
    });

    it("all carry an accessible name", () => {
        expect(files.flatMap(unnamedControlsUnderALabel)).toEqual([]);
    });

    it("the public store fields a visitor fills in are named", () => {
        for (const rel of [
            "module-sources/store/pages/public/cart/page.tsx",
            // The page is a server shell now; the fields a visitor fills in moved
            // with the screen that draws them.
            "module-sources/store/components/ProductView.tsx",
        ]) {
            expect(readFileSync(join(ROOT, rel), "utf8")).toContain("aria-label=");
        }
    });
});

describe("focus", () => {
    const files = SCANNED.flatMap((d) => tsxFiles(join(ROOT, d))).filter(
        (f) => !f.includes("/src/modules/"),
    );

    /**
     * Removing the focus ring without putting one back leaves a keyboard
     * user with no way to see where they are.
     */
    it("is never removed without a replacement", () => {
        const offenders: string[] = [];
        for (const file of files) {
            for (const line of readFileSync(file, "utf8").split("\n")) {
                if (!/\boutline-none\b/.test(line)) continue;
                if (/focus-visible:|focus:ring|ring-\d|focus-visible/.test(line)) continue;
                offenders.push(`${file.slice(ROOT.length + 1)} -> ${line.trim().slice(0, 70)}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
