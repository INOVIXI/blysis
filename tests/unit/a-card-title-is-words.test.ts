// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * A card is titled in words.
 *
 * Measured across the product before this was written: 146 card titles, and
 * 33 of them carried an icon - 3 of a module's 74, 14 of the panel's 56. So
 * the icon was never the convention; it was what somebody reached for on the
 * day they wrote that card, and the result was a column of headings that
 * jumped left and back as you scrolled past them.
 *
 * The profile was the worst of it and then briefly the opposite: seven cards
 * had no icon, seven did, and an attempt to settle it by giving every card one
 * made the profile the only place in the product that worked that way.
 *
 * So: none. A card's mark is its heading and its place on the page. Where an
 * icon carries meaning - a status, a warning - it belongs in the body next to
 * the thing it describes, not beside the title.
 */

const ROOT = process.cwd();

function cardTitles(): { file: string; title: string }[] {
    const out: { file: string; title: string }[] = [];

    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            if (entry.name === "node_modules") continue;
            const rel = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(rel);
            else if (entry.name.endsWith(".tsx")) {
                const body = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
                for (const match of body.matchAll(/<CardTitle[^>]*>([\s\S]{0,300}?)<\/CardTitle>/g)) {
                    out.push({ file: rel, title: match[1] });
                }
            }
        }
    };

    for (const root of ["src/app", "src/core/components", "module-sources"]) walk(root);
    return out;
}

const CARDS = cardTitles();

describe("a card title", () => {
    it("finds the cards, so a broken scan cannot pass quietly", () => {
        expect(CARDS.length).toBeGreaterThan(100);
    });

    it("is words, with no icon beside them", () => {
        const decorated = CARDS.filter((card) =>
            /<[A-Z][A-Za-z0-9]* className="[^"]*[wh]-\d/.test(card.title),
        ).map((card) => `${card.file}: ${card.title.replace(/\s+/g, " ").trim().slice(0, 40)}`);
        expect(decorated).toEqual([]);
    });
});
