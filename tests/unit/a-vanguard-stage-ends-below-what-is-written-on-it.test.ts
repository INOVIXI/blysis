import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Nothing written on Vanguard's stage stands where its ground can reach.
 *
 * The stage ends in a ridge of blocky hills in the page's own colour, the
 * ground the content below stands on. Its peaks rise up to `height` times
 * the highest point of its outline, and whatever the hero or a page header
 * writes last sits only the section's bottom padding above the stage's
 * edge. The hero kept 72px for a ground that reaches 86px, so in the light
 * mode the bottom of "ŞU AN EKİPTE", white on the night, ran onto the pale
 * page colour of a peak behind it.
 *
 * Measured against the ground at its tallest, because a section that grows
 * grows its ridge with it until the ridge reaches that cap.
 */

const CSS = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/themes/vanguard/theme.css"), "utf8");

function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
    if (!found) throw new Error(`theme.css has no ${selector} rule`);
    return found[1];
}

/** How far above the stage's bottom edge the ground's highest peak reaches. */
function groundReach(): number {
    const body = rule('.vg-ridge[data-depth="ground"]');
    const height = /height:\s*min\(\s*\d+%\s*,\s*(\d+)px\s*\)/.exec(body);
    const outline = /clip-path:\s*polygon\(([^)]*)\)/.exec(body);
    if (!height || !outline) throw new Error("the ground ridge has no capped height or no outline");
    // Each vertex is "x y"; the smallest y is the highest point.
    const ys = outline[1].split(",").map((vertex) => Number.parseFloat(vertex.trim().split(/\s+/)[1]));
    const highest = Math.min(...ys);
    return Number(height[1]) * (1 - highest / 100);
}

/** The bottom padding of a section, from its `padding` shorthand or `padding-bottom`. */
function bottomPadding(selector: string): number {
    const body = rule(selector);
    const own = /padding-bottom:\s*(\d+)px/.exec(body);
    if (own) return Number(own[1]);
    const shorthand = /padding:\s*([^;]+);/.exec(body);
    if (!shorthand) throw new Error(`${selector} sets no padding`);
    const parts = shorthand[1].trim().split(/\s+/).map((p) => Number.parseInt(p, 10));
    return parts.length === 1 ? parts[0] : parts.length === 2 ? parts[0] : parts[2];
}

/** Room left between the last line and the ground, so a descender clears it too. */
const CLEARANCE = 12;

describe("a Vanguard stage ends below what is written on it", () => {
    const reach = groundReach();

    it("reads the ground's reach", () => {
        expect(reach).toBeGreaterThan(40);
    });

    for (const section of [".vg-hero", ".vg-page-header"]) {
        it(`${section} keeps its content clear of the ground`, () => {
            expect(bottomPadding(section)).toBeGreaterThanOrEqual(Math.ceil(reach + CLEARANCE));
        });
    }
});
