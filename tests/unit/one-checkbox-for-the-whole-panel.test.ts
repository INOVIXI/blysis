import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source-text";

/**
 * There is one checkbox, and this is how it stays one.
 *
 * Twenty-nine screens had written `<input type="checkbox">` by hand, between
 * them using ten different class strings - `rounded`, `w-4 h-4`, `w-3 h-3`,
 * `mt-1`, `accent-primary`, and five that said nothing at all. The result was
 * boxes of different sizes on adjacent screens, all of them painted by the
 * operating system rather than the theme: the system's blue on light, and a
 * white box with a black hairline on a dark panel, whatever colours the site
 * had chosen.
 *
 * `Checkbox` and `CheckboxField` in `@/core/sdk/ui` are the answer. This test
 * is the part that keeps the thirtieth from being written by hand.
 */

const ROOT = join(__dirname, "..", "..");

function grep(pattern: string, paths: string[]): string[] {
    try {
        return execFileSync("grep", ["-rn", "--include=*.tsx", pattern, ...paths], {
            cwd: ROOT,
            encoding: "utf8",
        })
            .split("\n")
            .filter(Boolean);
    } catch {
        return []; // grep exits 1 when it matches nothing
    }
}

describe("one checkbox for the whole panel", () => {
    it("declares type=checkbox in exactly one component", () => {
        const offenders = grep('type="checkbox"', ["src", "module-sources"])
            .filter((line) => !line.startsWith("src/core/components/ui/checkbox.tsx:"))
            // src/modules is a build-time copy of module-sources; a fix has to
            // land in the source, and the copy follows on the next rsync.
            .filter((line) => !line.startsWith("src/modules/"));
        expect(offenders).toEqual([]);
    });

    it("is a box, not the radio button's circle", () => {
        // `rounded` resolves to the site-wide radius, which is 0.5rem by
        // default - half of this control, so every checkbox in the panel was
        // drawn as a perfect circle and could not be told apart from the radio
        // button beside it. The box uses its own clamp, which caps the theme's
        // radius at a third of the box and still collapses to 0 for a square
        // theme; the name changed when the box grew to 18px and the old
        // quarter-of-16 cap started reading as a hard corner beside the
        // buttons around it.
        const checkbox = fs.readFileSync(join(ROOT, "src/core/components/ui/checkbox.tsx"), "utf8");
        expect(checkbox).toContain("blysis-checkbox-radius");
        // The comments here explain the old class, so only the code counts.
        const code = stripComments(checkbox);
        expect(code).not.toMatch(/\brounded\b(?!-)/);
        const css = fs.readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
        expect(css).toContain(".blysis-checkbox-radius");
        // The clamp is the whole point: a theme radius written for buttons
        // must not reach this control unbounded.
        expect(css).toMatch(/\.blysis-checkbox-radius\s*\{[^}]*min\(var\(--blysis-radius\)/);
        // And the radio still is a circle, or the two have swapped problems.
        expect(fs.readFileSync(join(ROOT, "src/core/components/ui/radio.tsx"), "utf8"))
            .toContain("rounded-full");
    });

    it("fades a disabled box together with its tick", () => {
        // The tick is drawn as a sibling of the input, so `disabled:opacity-50`
        // on the input alone left a full-strength tick floating on a washed
        // out box - and `CheckboxField` faded the row on top of that, so the
        // box came out at 0.3 and the tick at 0.6.
        const checkbox = fs.readFileSync(join(ROOT, "src/core/components/ui/checkbox.tsx"), "utf8");
        expect(checkbox).toContain("has-[:disabled]:opacity-50");
        expect(checkbox).not.toContain("disabled:opacity-50\"");
        expect(checkbox).not.toContain('"cursor-not-allowed opacity-60"');
    });

    it("is actually used, in core and in the modules alike", () => {
        // If the component were only exported and never mounted, the test
        // above would pass on an empty panel.
        const core = grep("<Checkbox", ["src"]).filter((l) => !l.startsWith("src/modules/"));
        const modules = grep("<Checkbox", ["module-sources"]);
        expect(core.length).toBeGreaterThan(5);
        expect(modules.length).toBeGreaterThan(5);
    });
});
