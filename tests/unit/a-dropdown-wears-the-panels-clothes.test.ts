import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { stripComments } from "./source-text";
import { join } from "node:path";

/**
 * The admin had a themed `Input` and no themed dropdown, so every "pick one of
 * these strings" control was written as a bare `<select>`. A bare select is
 * painted by the browser: square corners, a hairline border, a system font,
 * and - on the roles screen, where the control is `required` and starts empty
 * - Firefox's red invalid outline, sitting beside a rounded themed input.
 *
 * `NativeSelect` is that same element with `appearance-none` and the panel's
 * own border, radius, height and focus ring. This gate keeps the bare element
 * from coming back, and keeps callers from re-declaring the styling the
 * component now owns (a caller's `px-3 py-2` beats the padding that keeps the
 * text clear of the chevron, because `cn` puts the caller's classes last).
 */

const ROOTS = ["src/app", "src/core", "module-sources"];

/** The component itself is the one place a bare `<select>` is the point. */
const BARE_SELECT_ALLOWLIST: Record<string, string> = {
    "src/core/components/ui/native-select.tsx":
        "This is the component that wraps the bare element; the raw <select> here is what every other file stopped writing.",
};

/** Classes NativeSelect sets itself. A caller repeating one of them wins over it. */
const OWNED = [
    /^rounded(-|$)/,
    /^border(-|$)/,
    /^bg-(background|card|input|white)$/,
    /^h-\d/,
    /^p[xy]?-\d/,
    /^text-(xs|sm|base)$/,
    /^appearance-/,
    /^focus:/,
    /^cursor-/,
];

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (full.endsWith(".tsx")) out.push(full);
    }
    return out;
}

/**
 * The end of a JSX opening tag. A plain `[^>]*` scan stops at the `>` of an
 * arrow function in `onChange={(e) => ...}`, which is why the tags here are
 * walked with the braces and strings accounted for.
 */
function openingTagEnd(src: string, start: number): number {
    let depth = 0;
    let quote: string | null = null;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) return i + 1;
    }
    return src.length;
}

const files = ROOTS.flatMap((root) => walk(root));

describe("a dropdown wears the panel's clothes", () => {
    it("has files to check", () => {
        expect(files.length).toBeGreaterThan(300);
    });

    it("leaves no bare <select> outside the component that wraps it", () => {
        const offenders = files.filter(
            (f) =>
                !BARE_SELECT_ALLOWLIST[f] &&
                // The comments go first. A file explaining why it no longer
                // writes a bare `<select>` is not a file writing one, and
                // this gate flagged exactly that - the forms builder, whose
                // note says the public form "drew a `<select>` holding one
                // empty entry".
                /<select[\s>]/.test(stripComments(readFileSync(f, "utf8"))),
        );
        expect(offenders).toEqual([]);
    });

    it("gives every allowlist entry a reason", () => {
        for (const [file, reason] of Object.entries(BARE_SELECT_ALLOWLIST)) {
            expect(files, `${file} is allowlisted but does not exist`).toContain(file);
            expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(40);
        }
    });

    it("does not let a caller re-declare the styling NativeSelect owns", () => {
        const offenders: string[] = [];
        for (const file of files) {
            const src = readFileSync(file, "utf8");
            if (!src.includes("<NativeSelect")) continue;
            let from = 0;
            for (;;) {
                const start = src.indexOf("<NativeSelect", from);
                if (start === -1) break;
                const end = openingTagEnd(src, start);
                const tag = src.slice(start, end);
                from = end;
                const cls = /className="([^"]*)"/.exec(tag);
                if (!cls) continue;
                for (const token of cls[1].split(/\s+/).filter(Boolean)) {
                    if (OWNED.some((re) => re.test(token))) {
                        offenders.push(`${file}: ${token}`);
                    }
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("keeps the dark-mode select override off the themed control", () => {
        const css = readFileSync("src/app/globals.css", "utf8");
        expect(css).toContain('select:not(.appearance-none)');
    });

    it("exports NativeSelect from the module SDK", () => {
        const sdk = readFileSync("src/core/sdk/ui.ts", "utf8");
        expect(sdk).toContain("NativeSelect");
    });
});
