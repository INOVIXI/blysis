import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every mode of every theme this repository ships can be read.
 *
 * A theme picks its colours once per mode, and the pairs core draws text in
 * are fixed: body text on the page, a card's text on the card, a filled
 * button's label on the brand colour, the quiet grey of a description on the
 * page and on a card. A pairing under WCAG AA's 4.5:1 is a screen somebody
 * cannot read, and it is decided in a manifest nobody renders while editing.
 * So it is measured here, for each mode, from what the generator would write.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const THEMES = path.join(ROOT, "src/themes");

/** Text colour, surface colour. */
const PAIRS: [string, string][] = [
    ["foreground", "background"],
    ["cardForeground", "card"],
    ["primaryForeground", "primary"],
    ["mutedForeground", "background"],
    ["mutedForeground", "card"],
];

function luminance(hex: string): number {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
    const [r, g, b] = [0, 2, 4].map((i) => {
        const c = parseInt(full.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

interface Manifest {
    tokens?: { colors?: Record<string, { default?: string }> };
    modes: { available: Record<string, { tokens?: { colors?: Record<string, string> } }> };
}

function modes(): { where: string; colors: Record<string, string> }[] {
    const out: { where: string; colors: Record<string, string> }[] = [];
    for (const id of fs.readdirSync(THEMES)) {
        const file = path.join(THEMES, id, "theme.json");
        if (!fs.existsSync(file)) continue;
        const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
        for (const [mode, def] of Object.entries(manifest.modes.available)) {
            const colors: Record<string, string> = {};
            for (const [name, token] of Object.entries(manifest.tokens?.colors ?? {})) {
                if (token.default) colors[name] = token.default;
            }
            Object.assign(colors, def.tokens?.colors ?? {});
            out.push({ where: `${id}/${mode}`, colors });
        }
    }
    return out;
}

describe("contrast", () => {
    it("measures the way WCAG does", () => {
        expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
        expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    });
});

describe("every theme mode", () => {
    const all = modes();

    it("is found, so a broken scan cannot pass quietly", () => {
        expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it("sets text it can be read in", () => {
        const offenders: string[] = [];
        for (const { where, colors } of all) {
            for (const [text, surface] of PAIRS) {
                if (!colors[text] || !colors[surface]) continue;
                const ratio = contrast(colors[text], colors[surface]);
                if (ratio < 4.5) offenders.push(`${where}: ${text} on ${surface} is ${ratio.toFixed(2)}:1`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
