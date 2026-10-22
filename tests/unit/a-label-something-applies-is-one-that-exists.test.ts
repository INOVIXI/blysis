// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A label something applies is one that exists.
 *
 * GitHub drops a label that does not exist without a word. Dependabot's config
 * asked for `dependencies` and `ci` on every update it opened, neither label
 * had ever been created, and so not one dependency PR carried a label. Every
 * label is now defined in `.github/labels.json`, which the Labels workflow
 * applies to the repository, and everything that names a label is read here.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

interface Label {
    name: string;
    color: string;
    description: string;
}

interface Size extends Label {
    maxLines: number | null;
}

const { labels, sizes } = JSON.parse(read(".github/labels.json")) as { labels: Label[]; sizes: Size[] };
const DEFINED = new Set([...labels, ...sizes].map((l) => l.name));

/** `labels: ["a", "b"]` in an issue form, and the `labels:` lists in dependabot.yml. */
function yamlLabels(text: string): string[] {
    const inline = [...text.matchAll(/^labels:\s*\[([^\]]*)\]/gm)].flatMap((m) =>
        m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean),
    );
    const lists = [...text.matchAll(/^(\s*)labels:\s*\n((?:\1\s+-\s*.+\n?)+)/gm)].flatMap((m) =>
        [...m[2].matchAll(/-\s*["']?([^"'\n]+?)["']?\s*$/gm)].map((item) => item[1]),
    );
    return [...inline, ...lists];
}

function appliers(): Record<string, string[]> {
    const templates = fs
        .readdirSync(path.join(ROOT, ".github/ISSUE_TEMPLATE"))
        .filter((name) => name.endsWith(".yml") && name !== "config.yml")
        .map((name) => `.github/ISSUE_TEMPLATE/${name}`);
    const found: Record<string, string[]> = {};
    for (const rel of [...templates, ".github/dependabot.yml"]) found[rel] = yamlLabels(read(rel));
    const triage = ".claude/skills/contribution-triage/SKILL.md";
    found[triage] = [...read(triage).matchAll(/`(triage:[a-z-]+)`/g)].map((m) => m[1]);
    return found;
}

describe("a label something applies", () => {
    it("is defined in labels.json", () => {
        const missing = Object.entries(appliers()).flatMap(([rel, names]) =>
            names.filter((name) => !DEFINED.has(name)).map((name) => `${rel}: ${name}`),
        );
        expect(missing).toEqual([]);
    });

    it("is read from every place that applies one", () => {
        for (const [rel, names] of Object.entries(appliers())) expect(names.length, rel).toBeGreaterThan(0);
        expect(appliers()[".github/dependabot.yml"]).toEqual(expect.arrayContaining(["dependencies", "ci"]));
    });

    it("is read the way the templates and dependabot write it", () => {
        expect(yamlLabels('labels: ["bug", \'x\']\n')).toEqual(["bug", "x"]);
        expect(yamlLabels('  - a: 1\n    labels:\n      - "dependencies"\n      - ci\n  - b: 2\n')).toEqual(["dependencies", "ci"]);
    });
});

describe("the labels", () => {
    it("are each defined once, with a colour GitHub accepts and a description", () => {
        const names = [...labels, ...sizes].map((l) => l.name);
        expect(new Set(names).size).toBe(names.length);
        for (const label of [...labels, ...sizes]) {
            expect(label.color, label.name).toMatch(/^[0-9a-f]{6}$/);
            // GitHub refuses a description over 100 characters.
            expect(label.description.length, label.name).toBeGreaterThan(0);
            expect(label.description.length, label.name).toBeLessThanOrEqual(100);
        }
    });

    it("size every pull request, smallest first, with nothing above the last", () => {
        const bounds = sizes.map((s) => s.maxLines);
        expect(bounds.at(-1)).toBeNull();
        const finite = bounds.slice(0, -1) as number[];
        expect(finite.every((n) => Number.isInteger(n))).toBe(true);
        expect(finite).toEqual([...finite].sort((a, b) => a - b));
        expect(new Set(finite).size).toBe(finite.length);
    });
});
