// @vitest-environment node
/**
 * A control that looks like a button is the product's button.
 *
 * `buttonClassName` carries eleven things, and a hand-written control carries
 * whichever of them its author remembered. The popup that announces a season
 * is what this was written for: its two controls were painted by hand, so the
 * one that closes it had no border radius at all. A dialog moves focus to its
 * first control when it opens, the focus ring follows the element's shape,
 * and a reader whose screen had nothing wrong with it saw a square blue box
 * drawn around "Kapat" beside a rounded blue button. Measured on the running
 * site: 0px against 8px, and both controls 32px tall against a scale whose
 * smallest step is 36.
 *
 * The rest of that class list is the part nobody notices is missing until
 * somebody needs it: the focus ring and its offset, `disabled:opacity-50`,
 * `cursor-pointer` where Tailwind's reset takes it away, and the `-foreground`
 * token that keeps a label readable when a theme picks a pale primary.
 *
 * So the rule is that a control painted in one of the product's own colours
 * asks `buttonClassName` for the paint. What is exempt is what is not a
 * control: a badge, a ribbon, a highlighted row.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/**
 * Painted in a colour that belongs to a button, and spaced like one.
 *
 * Both halves are needed. The colour alone catches a badge, and the padding
 * alone catches every box on the site.
 */
const PAINTED = /\bbg-(?:primary|secondary|destructive)\b(?![\w/-])/;
const SPACED = /\bp[xy]?-\d/;

/**
 * Not a control, and not pretending to be one. Each of these was looked at.
 */
const NOT_A_CONTROL: { file: string; why: string }[] = [
    {
        file: "module-sources/store/pages/public/vip/page.tsx",
        why: "the ribbon across the corner of the recommended plan is a label on a card, not something to press",
    },
    {
        file: "src/core/components/ui/footer-dropdown.tsx",
        why: "the rows inside the open panel are a list of choices, and the painted one is the choice in force rather than the action to take",
    },
    {
        file: "src/app/[locale]/layout.tsx",
        why: "the skip link is invisible until it is focused, so it paints itself only in that state and a button's resting class list would undo the sr-only it depends on",
    },
];

/**
 * Says which one it is rather than what to do.
 *
 * A segmented period picker, a tag chip, a three-state permission cell, a day
 * toggle: the colour on these means selected, not primary. Giving them a
 * button's shape would make a row of pills into a row of buttons and lose the
 * thing the shape was saying. They are recognised by the state they announce
 * rather than listed by hand, so the next one is covered without an edit.
 */
const ANNOUNCES_STATE = /\baria-(?:pressed|selected|checked)\b|role=(?:"|')(?:option|tab)(?:"|')/;

/**
 * Every `<button>` and `<a>` opening tag, with the classes it carries.
 *
 * The tag is read by walking it rather than by a regex ending at the first
 * `>`, because an attribute holds them: `onClick={() => reset()}` closes the
 * tag three characters into the handler, and the first version of this gate
 * silently skipped every control that had one. Depth over braces, and quotes
 * respected, so the tag ends where it actually ends.
 */
function tagAttributes(source: string, from: number): { text: string; end: number } | null {
    let depth = 0;
    let quote: string | null = null;
    for (let i = from; i < source.length; i += 1) {
        const c = source[i];
        if (quote) {
            if (c === quote && source[i - 1] !== "\\") quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "{") { depth += 1; continue; }
        if (c === "}") { depth -= 1; continue; }
        if (c === ">" && depth === 0) return { text: source.slice(from, i), end: i };
    }
    return null;
}

function paintedControls(): string[] {
    const OPEN = /<(button|a)[\s>]/g;
    const CLASS = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cn\(([\s\S]*?)\)\})/;
    const found: string[] = [];

    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name === "generated") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.endsWith(".tsx")) continue;

            const relative = path.relative(ROOT, full);
            if (NOT_A_CONTROL.some((exempt) => exempt.file === relative)) continue;
            // The button is allowed to paint itself.
            if (relative.endsWith("core/components/ui/button.tsx")) continue;

            const source = fs.readFileSync(full, "utf8");
            for (const open of source.matchAll(OPEN)) {
                const tag = tagAttributes(source, open.index + open[0].length - 1);
                if (!tag) continue;
                if (tag.text.includes("buttonClassName")) continue;
                if (ANNOUNCES_STATE.test(tag.text)) continue;
                const classes = CLASS.exec(tag.text);
                const value = classes?.[1] ?? classes?.[2] ?? classes?.[3] ?? "";
                if (PAINTED.test(value) && SPACED.test(value)) {
                    found.push(`${relative}:${source.slice(0, open.index).split("\n").length} <${open[1]}>`);
                }
            }
        }
    };

    for (const dir of ["src/app", "src/core/components", "module-sources"]) {
        walk(path.join(ROOT, dir));
    }
    return found;
}

describe("a control painted in the product's own colours", () => {
    it("asks the button for the paint, rather than remembering ten of its eleven parts", () => {
        expect(
            paintedControls(),
            "these carry a button's colour and a button's spacing without its class list, " +
            "so each is missing whichever parts its author did not think of - the radius, " +
            "the focus ring, the disabled state. Use buttonClassName, or add the file to " +
            "NOT_A_CONTROL above with the reason it is not something to press",
        ).toEqual([]);
    });

    it("still says why each exemption is one", () => {
        for (const exempt of NOT_A_CONTROL) {
            expect(fs.existsSync(path.join(ROOT, exempt.file)), exempt.file).toBe(true);
            expect(exempt.why.length, exempt.file).toBeGreaterThan(20);
        }
    });
});
