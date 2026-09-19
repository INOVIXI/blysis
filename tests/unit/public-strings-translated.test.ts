import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripComments } from "./source-text";

/**
 * What a visitor sees is translated.
 *
 * The public chrome had English baked into it: the maintenance page's
 * heading and its sign-in button, the activity page's title and description
 * (including the ones a crawler reads out of the metadata), the homepage
 * activity section's heading and its "View all" link, the file upload
 * control, and the navigation landmark labels that a screen reader reads to
 * tell one nav apart from another. A Turkish visitor got those in English.
 *
 * The rule holds for the public tree only. `app/error.tsx`,
 * `app/not-found.tsx` and `app/global-error.tsx` stay in English on purpose:
 * they render outside the locale layout, so there is no provider to ask.
 *
 * The two error boundaries used to be listed here on the same grounds, that a
 * class component cannot call a hook. That was the wrong conclusion from a
 * true fact: both render inside the locale layout's provider, and what a class
 * cannot do, a function component it renders can. They are translated now, and
 * `an-error-notice-is-in-the-readers-language.test.ts` keeps them that way.
 */

const root = path.resolve(import.meta.dirname, "../..");

const PUBLIC_SURFACE = [
    "src/app/[locale]/(public)",
    // Sign in, register, forgot and reset password, verify email, auth error.
    // The most-read pages on a fresh install and covered by neither gate
    // until now, which is how the register form kept an English placeholder
    // and its sibling login page did not.
    "src/app/[locale]/(auth)",
    "src/app/[locale]/maintenance",
    "src/core/components/layout",
    "src/core/components/homepage",
];

/**
 * A module's own visitor-facing surface, which no gate watched either. The
 * whole of the public ticket page was in English, as were the referral tab
 * on a user's profile, the custom page 404, the announcement dismiss button,
 * the store's payment-goal banner and four page-builder blocks' empty
 * states. Most of those keys already existed in every locale of the module's
 * manifest; the components had simply never been wired to them.
 */
const MODULE_SURFACE = ["pages/public", "blocks", "slots", "widgets", "components"];

/** Proper nouns. A brand is spelled the same in every locale. */
const BRAND_NAMES = new Set([
    "Facebook", "Instagram", "X (Twitter)", "YouTube", "Discord", "Twitch", "TikTok",
    // Reached once the scan covers the modules. A game, two payment
    // providers, and the example username every Minecraft screenshot uses.
    "Twitter", "Minecraft", "Stripe", "PayPal", "Notch",
]);

function tsxFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) tsxFiles(full, out);
        else if (entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
}

function isTranslatable(text: string): boolean {
    if (BRAND_NAMES.has(text)) return false;
    // A word the user has to type back verbatim, or an acronym.
    if (!/[a-z]/.test(text)) return false;
    // An example value rather than prose.
    if (/^https?:\/\//.test(text)) return false;
    return true;
}

function englishLiterals(file: string): string[] {
    // Comments first: the footer explains in prose that a sentence "came out
    // as Built with by Blysis", and a scan that reads its own documentation
    // reports the bug it describes as the bug itself.
    const source = stripComments(fs.readFileSync(file, "utf8"));
    const found: string[] = [];

    // A JSX text node that reads like a sentence or a label.
    for (const match of source.matchAll(/>\s*([A-Z][A-Za-z][A-Za-z'’,.!?%: -]{3,60})\s*</g)) {
        const text = match[1].trim();
        if (isTranslatable(text)) found.push(`text: ${text}`);
    }

    // A label a screen reader reads, written as a literal.
    for (const match of source.matchAll(/(placeholder|aria-label|title)=["']([^"']{2,60})["']/g)) {
        if (isTranslatable(match[2])) found.push(`${match[1]}: ${match[2]}`);
    }

    /*
     * A string drawn from inside an expression rather than written as text.
     *
     * `{sending ? "Sending..." : "Send Reply"}` renders exactly what a text
     * node renders and reads exactly as English to a Turkish visitor, but it
     * is not between a `>` and a `<`, so the scan above never saw it. The
     * public ticket page kept its reply button in English through two passes
     * of this gate for that reason.
     */
    for (const match of source.matchAll(/>\s*\{([^{}]*)\}\s*</g)) {
        for (const literal of match[1].matchAll(/["']([A-Z][A-Za-z][A-Za-z'’,.!?%: -]{2,60})["']/g)) {
            const text = literal[1].trim();
            if (isTranslatable(text)) found.push(`expression: ${text}`);
        }
    }

    return found.map((hit) => `${path.relative(root, file)} -> ${hit}`);
}

function moduleSurfaceFiles(): string[] {
    const sources = path.join(root, "module-sources");
    if (!fs.existsSync(sources)) return [];
    return fs
        .readdirSync(sources, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .flatMap((mod) =>
            MODULE_SURFACE.flatMap((sub) => tsxFiles(path.join(sources, mod.name, sub))),
        );
}

describe("the public surface", () => {
    const files = PUBLIC_SURFACE.flatMap((dir) => tsxFiles(path.join(root, dir)));

    it("covers the pages and the chrome a visitor sees", () => {
        expect(files.length).toBeGreaterThan(5);
    });

    it("has no English baked into it", () => {
        expect(files.flatMap(englishLiterals)).toEqual([]);
    });
});

describe("the modules' public surface", () => {
    const files = moduleSurfaceFiles();

    it("covers every module's pages, blocks, slots, widgets and components", () => {
        expect(files.length).toBeGreaterThan(50);
    });

    it("has no English baked into it", () => {
        expect(files.flatMap(englishLiterals)).toEqual([]);
    });
});
