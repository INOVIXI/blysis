import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * What a module draws under Vanguard's hero is read in the stage's colours.
 *
 * The hero is the stage, dark in both modes, and `hero.bottom` is a slot a
 * module fills with components written for the page: `text-muted-foreground`,
 * `bg-muted`, `text-foreground`. The theme used to repaint only the
 * backgrounds there, so in the light mode the staff strip's avatar initial kept
 * the page's dark grey on a dark square and could not be seen at all.
 *
 * So under the hero the page's own tokens are the stage's: whatever a module
 * draws with them is in colours made for that ground. Measured here as a
 * reader would see them, the text on the surface it sits on.
 */

const THEME = path.resolve(import.meta.dirname, "../../src/themes/vanguard");
const CSS = fs.readFileSync(path.join(THEME, "theme.css"), "utf8");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(THEME, "theme.json"), "utf8")) as {
    tokens: { colors: Record<string, { default?: string }> };
    modes: { available: Record<string, { tokens?: { colors?: Record<string, string> } }> };
};

/** The custom properties `.vg-hero-bottom` sets for what is drawn inside it. */
function stageTokens(): Record<string, string> {
    const block = /\.vg-hero-bottom\s*\{([^}]*)\}/.exec(CSS);
    if (!block) throw new Error("theme.css has no .vg-hero-bottom rule");
    return Object.fromEntries(
        [...block[1].matchAll(/--blysis-color-([A-Za-z]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    );
}

function rgb(hex: string): [number, number, number] {
    const h = hex.replace("#", "").slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
    const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/**
 * A declared value as the colour it paints over the stage: a stage token
 * itself, or `color-mix(in srgb, <stage token> N%, transparent)` laid on the
 * stage, which is what a translucent surface there looks like.
 */
function resolve(value: string, colors: Record<string, string>): [number, number, number] {
    const token = /^var\(--blysis-color-([A-Za-z]+)\)$/.exec(value);
    if (token) return rgb(colors[token[1]]);
    const mix = /^color-mix\(in srgb,\s*var\(--blysis-color-([A-Za-z]+)\)\s+(\d+)%,\s*transparent\)$/.exec(value);
    if (mix) {
        const [top, ground, share] = [rgb(colors[mix[1]]), rgb(colors.stage), Number(mix[2]) / 100];
        return top.map((c, i) => Math.round(c * share + ground[i] * (1 - share))) as [number, number, number];
    }
    throw new Error(`cannot read ${value}`);
}

/** Text token, the surface it is drawn on inside the slot. */
const PAIRS: [string, string][] = [
    ["foreground", "background"],
    ["mutedForeground", "background"],
    ["mutedForeground", "muted"],
    ["foreground", "muted"],
    ["cardForeground", "card"],
];

describe("what a module draws on the Vanguard stage", () => {
    const declared = stageTokens();

    it("takes every text and surface token from the stage", () => {
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
                .map(([text, surface]) => ({
                    pair: `${text} on ${surface}`,
                    ratio: contrast(resolve(declared[text], colors), resolve(declared[surface], colors)),
                }))
                .filter(({ ratio }) => ratio < 4.5)
                .map(({ pair, ratio }) => `${pair}: ${ratio.toFixed(2)}`);
            expect(unreadable).toEqual([]);
        });
    }
});
