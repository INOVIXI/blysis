import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { scopeThemeStylesheet } from "../../scripts/lib/theme-stylesheet";
import { buttonClassName } from "@/core/components/ui/button";
import { badgeClassName } from "@/core/components/ui/badge";
import { Card } from "@/core/components/ui/card";

/**
 * A theme's own stylesheet draws only while that theme is worn.
 *
 * Every installed theme's CSS is compiled into the one stylesheet the site
 * serves, so a rule a theme writes as `.card { ... }` would land on every
 * site that merely has the theme installed, whichever theme it is wearing.
 * The generator scopes each rule to `[data-theme="<id>"]`, which is the html
 * element, so the theme author writes plain selectors and cannot forget.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

describe("a theme stylesheet", () => {
    it("scopes a plain rule to its theme", () => {
        const out = scopeThemeStylesheet("vanguard", ".stage { color: red; }");
        expect(out).toContain('[data-theme="vanguard"] .stage');
        expect(out).not.toMatch(/(^|\})\s*\.stage/);
    });

    it("scopes every selector in a list, not only the first", () => {
        const out = scopeThemeStylesheet("vanguard", "h1, h2 { text-transform: uppercase; }");
        expect(out).toContain('[data-theme="vanguard"] h1');
        expect(out).toContain('[data-theme="vanguard"] h2');
    });

    it("reads html and :root as the element the theme is declared on", () => {
        // `[data-theme] html` would never match: the attribute is on html.
        const out = scopeThemeStylesheet("vanguard", ':root { --x: 1; } html[data-mode="dark"] .a { color: red; }');
        expect(out).toContain('[data-theme="vanguard"] {');
        expect(out).toContain('[data-theme="vanguard"][data-mode="dark"] .a');
        expect(out).not.toContain("html");
        expect(out).not.toContain(":root");
    });

    it("scopes the rules inside a media query", () => {
        const out = scopeThemeStylesheet("vanguard", "@media (min-width: 1024px) { .rail { display: block; } }");
        expect(out).toContain('[data-theme="vanguard"] .rail');
    });

    it("leaves keyframes alone, because their steps are not selectors", () => {
        const out = scopeThemeStylesheet("vanguard", "@keyframes drift { from { opacity: 0; } to { opacity: 1; } }");
        expect(out).toContain("from");
        expect(out).not.toContain('[data-theme="vanguard"] from');
    });

    it("drops an import, which could pull in anything from anywhere", () => {
        const out = scopeThemeStylesheet("vanguard", '@import url("https://example.com/x.css"); .a { color: red; }');
        expect(out).not.toContain("@import");
        expect(out).toContain('[data-theme="vanguard"] .a');
    });

    it("refuses a theme id that is not one", () => {
        expect(() => scopeThemeStylesheet('x"]{} *', ".a{}")).toThrow();
    });
});

describe("a primitive a theme dresses", () => {
    // A theme stylesheet cannot reach a button by its utility classes, which
    // change whenever somebody restyles it, so each primitive carries one
    // stable class that means "this is a button" and nothing else.
    it("names itself, whatever its variant", () => {
        for (const variant of ["default", "outline", "ghost", "link"] as const) {
            expect(buttonClassName(variant).split(" ")).toContain("blysis-button");
        }
        expect(badgeClassName("success").split(" ")).toContain("blysis-badge");
        expect(badgeClassName("info", undefined, true).split(" ")).toContain("blysis-badge");
        expect(renderToStaticMarkup(createElement(Card))).toContain("blysis-card");
    });
});

describe("the site's stylesheet", () => {
    it("takes in the scoped theme styles after the tokens", () => {
        const globals = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
        const tokens = globals.indexOf('@import "../core/generated/theme-tokens.css"');
        const styles = globals.indexOf('@import "../core/generated/theme-styles.css"');
        expect(tokens).toBeGreaterThan(-1);
        expect(styles).toBeGreaterThan(tokens);
    });
});
