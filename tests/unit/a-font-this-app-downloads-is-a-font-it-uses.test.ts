import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A font the app downloads is a font it renders with.
 *
 * `next/font/google` self-hosts Inter, Outfit and JetBrains Mono, preloads
 * them and generates a fallback whose metrics are adjusted to match, which is
 * how a font swap stops moving the page. It publishes each one under a
 * generated family name and hands you a CSS variable to reach it by.
 *
 * Nothing referenced those variables. Every theme asked for `Inter` and
 * `Outfit` by their plain names, which the self hosted copies are not
 * registered under, so all three downloads were dead weight on a first visit.
 * `Inter` still rendered, from `https://rsms.me`, because the block editor's
 * stylesheet imports it and that stylesheet reaches public pages. It arrived
 * around 150ms and it is about ten percent wider than the system fallback,
 * which was enough to push the navigation onto a second row on nine public
 * pages: 0.05 to 0.12 of layout shift each, against a 0.1 budget.
 *
 * Two things have to hold for a variable to work here, and both are pinned.
 * The variables have to be declared on the element the theme tokens are
 * declared on, which is `html`: a custom property is substituted on the
 * element that declares it, so a token on `html` cannot read a variable that
 * only exists on `body`. And a theme has to actually name one.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const LAYOUT = fs.readFileSync(path.join(ROOT, "src/app/[locale]/layout.tsx"), "utf8");

/** The CSS variables `next/font` is asked to publish. */
function declaredVariables(): string[] {
    return [...LAYOUT.matchAll(/variable:\s*"(--font-[\w-]+)"/g)].map((m) => m[1]);
}

/** Every font stack a theme or the stylesheet defaults set. */
function fontStacks(): { where: string; value: string }[] {
    const out: { where: string; value: string }[] = [];
    const themes = path.join(ROOT, "src/themes");
    for (const name of fs.existsSync(themes) ? fs.readdirSync(themes) : []) {
        const file = path.join(themes, name, "theme.json");
        if (!fs.existsSync(file)) continue;
        const source = fs.readFileSync(file, "utf8");
        for (const m of source.matchAll(/"(heading|body|mono)":\s*"((?:[^"\\]|\\.)*)"/g)) {
            out.push({ where: `src/themes/${name}/theme.json (${m[1]})`, value: m[2] });
        }
    }
    const globals = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    for (const m of globals.matchAll(/--blysis-font-(heading|body|mono):\s*([^;]+);/g)) {
        out.push({ where: `src/app/globals.css (${m[1]})`, value: m[2].trim() });
    }
    return out;
}

describe("a font this app downloads", () => {
    it("is reachable from the element the theme tokens are declared on", () => {
        // Tokens land on `[data-theme][data-mode]`, which is the html element.
        // Matched by the tag that renders rather than by the first `<html` in
        // the file: a comment above quotes one to explain a routing bug.
        const rendered = [...LAYOUT.matchAll(/<html\b[^>]*>/g)].find((m) => m[0].includes("{locale}"));
        expect(rendered, "the layout should render an html element").toBeTruthy();
        const html = rendered![0];
        const missing = declaredVariables().filter((v) => {
            const owner = v.replace("--font-", "");
            return !new RegExp(`\\b\\w*${owner.replace(/-/g, "")}\\w*\\.variable`, "i").test(html);
        });
        expect(
            missing,
            `these are published on an element the theme tokens cannot read from:\n${missing.join("\n")}`,
        ).toEqual([]);
    });

    it("is named by something that renders", () => {
        const stacks = fontStacks();
        expect(stacks.length, "themes should declare font stacks").toBeGreaterThan(3);
        const unused = declaredVariables().filter(
            (v) => !stacks.some((s) => s.value.includes(`var(${v})`)),
        );
        expect(
            unused,
            `downloaded on every first visit and named by no theme:\n${unused.join("\n")}`,
        ).toEqual([]);
    });
});
