import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compile } from "@tailwindcss/node";

/**
 * Every rounded corner on the site follows the theme's radius.
 *
 * A theme sets `--blysis-radius` and the stylesheet mapped it to `--radius`,
 * which only the bare `rounded` class reads. The scale everybody writes -
 * `rounded-lg` on a card, `rounded-md` on a small button, `rounded-xl` on a
 * panel, a few hundred of them across core and the modules - kept Tailwind's
 * fixed lengths, so a theme asking for square corners got square inputs
 * inside round cards beside round buttons.
 *
 * The scale is now a multiple of the theme's radius, chosen so the radius the
 * default theme ships (0.5rem) gives exactly Tailwind's own lengths: nothing
 * changes on a site that never touched it. Measured by compiling the real
 * stylesheet, not by reading it, because what matters is the rule Tailwind
 * writes for the class.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const GLOBALS = path.join(ROOT, "src/app/globals.css");
const SCALE = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];
const DEFAULT_RADIUS_REM = 0.5;

/** Tailwind's own lengths for the scale, read from the version installed. */
function tailwindDefaults(): Record<string, number> {
    const theme = fs.readFileSync(path.join(ROOT, "node_modules/tailwindcss/theme.css"), "utf8");
    const out: Record<string, number> = {};
    for (const m of theme.matchAll(/--radius-([a-z0-9]+):\s*([\d.]+)rem;/g)) out[m[1]] = Number(m[2]);
    return out;
}

async function ruleFor(className: string): Promise<string> {
    // `@source` points at the installed modules, which a scan is not needed
    // for: the class is named to `build` directly.
    const css = fs.readFileSync(GLOBALS, "utf8").replace(/@source[^;]*;/g, "");
    const compiler = await compile(css, { base: path.dirname(GLOBALS), onDependency: () => {} });
    const out = compiler.build([className]);
    // Every character a pattern reads as syntax, not only the hyphen:
    // CodeQL flagged a backslash in a class name going through unescaped.
    const m = new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}\\s*\\{\\s*border-radius:\\s*([^;]+);`).exec(out);
    expect(m, `no border-radius rule was written for .${className}`).toBeTruthy();
    return m![1].trim();
}

/** The length a rule resolves to when the theme's radius is `radiusRem`. */
function resolve(value: string, radiusRem: number): number | null {
    const m = /^calc\(var\(--blysis-radius\)\s*\*\s*([\d.]+)\)$/.exec(value);
    return m ? Number(m[1]) * radiusRem : null;
}

describe("a rounded corner", () => {
    const defaults = tailwindDefaults();

    it("knows Tailwind's scale, so a broken read cannot pass quietly", () => {
        for (const step of SCALE) expect(defaults[step], step).toBeGreaterThan(0);
    });

    for (const step of SCALE) {
        it(`rounded-${step} is a multiple of the theme's radius`, async () => {
            const value = await ruleFor(`rounded-${step}`);
            expect(resolve(value, DEFAULT_RADIUS_REM), `rounded-${step} is ${value}`).not.toBeNull();
        });

        it(`rounded-${step} is Tailwind's own length on the default theme`, async () => {
            const value = await ruleFor(`rounded-${step}`);
            expect(resolve(value, DEFAULT_RADIUS_REM)).toBeCloseTo(defaults[step], 5);
        });
    }

    it("is square everywhere when the theme asks for none", async () => {
        for (const step of SCALE) {
            expect(resolve(await ruleFor(`rounded-${step}`), 0)).toBe(0);
        }
    });

    it("leaves a pill a pill", async () => {
        // `rounded-full` is a shape, not a size on the scale: an avatar stays
        // round on a square theme.
        expect(await ruleFor("rounded-full")).not.toContain("--blysis-radius");
    });
});
