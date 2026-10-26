import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * What a module draws under Quarry's hero is read in the hero's colours.
 *
 * The hero is dark in both modes and `hero.bottom` is filled with components
 * written for the page: `text-muted-foreground`, `bg-muted`,
 * `text-foreground`. In the light mode those are dark grey, and on the hero
 * they would not be seen. So under the hero the page's tokens are the
 * hero's, measured here as a reader sees them: the text on the surface it
 * sits on, a translucent surface laid over the hero's colour.
 */

const THEME = path.resolve(import.meta.dirname, "../../src/themes/quarry");
const CSS = fs.readFileSync(path.join(THEME, "theme.css"), "utf8");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(THEME, "theme.json"), "utf8")) as {
    tokens: { colors: Record<string, { default?: string }> };
    modes: { available: Record<string, { tokens?: { colors?: Record<string, string> } }> };
};

function heroTokens(): Record<string, string> {
    const block = /\.qr-hero-bottom\s*\{([^}]*)\}/.exec(CSS);
    if (!block) throw new Error("theme.css has no .qr-hero-bottom rule");
    return Object.fromEntries(
        [...block[1].matchAll(/--blysis-color-([A-Za-z]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    );
}

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
    const h = hex.replace("#", "").slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function contrast(a: Rgb, b: Rgb): number {
    const lum = ([r, g, b]: Rgb) => {
        const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** A declared value as the colour it paints over the hero. */
function resolve(value: string, colors: Record<string, string>): Rgb {
    const token = /^var\(--blysis-color-([A-Za-z]+)\)$/.exec(value);
    if (token) return rgb(colors[token[1]]);
    const mix = /^color-mix\(in srgb,\s*var\(--blysis-color-([A-Za-z]+)\)\s+(\d+)%,\s*transparent\)$/.exec(value);
    if (mix) {
        const [top, ground, share] = [rgb(colors[mix[1]]), rgb(colors.stage), Number(mix[2]) / 100];
        return top.map((c, i) => Math.round(c * share + ground[i] * (1 - share))) as Rgb;
    }
    throw new Error(`cannot read ${value}`);
}

const PAIRS: [string, string][] = [
    ["foreground", "background"],
    ["mutedForeground", "background"],
    ["mutedForeground", "muted"],
    ["foreground", "muted"],
    ["cardForeground", "card"],
];

describe("what a module draws on the Quarry hero", () => {
    const declared = heroTokens();

    it("takes every text and surface token from the hero", () => {
        for (const [text, surface] of PAIRS) {
            expect(declared[text], `--blysis-color-${text}`).toBeDefined();
            expect(declared[surface], `--blysis-color-${surface}`).toBeDefined();
        }
    });

    for (const [mode, def] of Object.entries(MANIFEST.modes.available)) {
        const colors: Record<string, string> = {};
        for (const [name, token] of Object.entries(MANIFEST.tokens.colors)) if (token.default) colors[name] = token.default;
        Object.assign(colors, def.tokens?.colors ?? {});

        it(`can be read in the ${mode} mode`, () => {
            const unreadable = PAIRS
                .map(([text, surface]) => ({ pair: `${text} on ${surface}`, ratio: contrast(resolve(declared[text], colors), resolve(declared[surface], colors)) }))
                .filter(({ ratio }) => ratio < 4.5)
                .map(({ pair, ratio }) => `${pair}: ${ratio.toFixed(2)}`);
            expect(unreadable).toEqual([]);
        });
    }
});
