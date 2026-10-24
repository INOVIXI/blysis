/**
 * The admin panel is painted in the theme's colours, not Tailwind's.
 *
 * `bg-green-100 text-green-700` is a light chip with dark green text on it,
 * always, whoever is looking and whatever theme is installed. The panel
 * switches to dark on `[data-mode="dark"]` at the root - not on Tailwind's
 * `dark:` variant, which follows the operating system - so those chips stayed
 * bright on a dark panel, and the `dark:bg-green-950` some of them carried
 * never fired at all. A theme that recoloured the whole admin could not touch
 * any of them either.
 *
 * Every one of them is a token now: `bg-success/10 text-success`, and the
 * tokens are redefined per mode and per theme. This keeps the palette out.
 *
 * Scope is core's own surface, which is both halves of the site: the admin
 * panel and the public chrome core draws around a theme - the navbar, the
 * footer, the profile screen, the homepage shell. All of it recolours with
 * the theme, and all of it had the same drift: a blue avatar circle, a red
 * error box, a sign-out in `text-red-600 hover:bg-red-50`, a breadcrumb
 * hovering blue on a site with no blue in it.
 *
 * A module is in scope too, on both of its surfaces. Its admin screens were
 * always here; its public ones were left out on the reasoning that a module's
 * own page is its own design. That was wrong, and the store showed why: the
 * VIP page painted its buy buttons `bg-blue-600 hover:bg-blue-700 text-white`
 * over the themed Button underneath, the support list gave every ticket
 * status a `bg-blue-100 text-blue-700` chip that stayed light on a dark site,
 * and prices and links were blue on a site with no blue in it. A site owner
 * installs a theme to recolour the site, and the store is the page most of
 * their visitors see.
 *
 * A theme under src/themes IS a design and names whatever colours it likes.
 * Brand marks are the one exception inside core: a Facebook button hovering
 * Facebook blue is not drift, it is the mark, so the footer's social links
 * name their own colours below.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");

const PALETTE = "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";
const FIXED = new RegExp(String.raw`\b(?:bg|text|border|ring|from|to|via)-(?:${PALETTE})-\d{2,3}\b`, "g");
/** Tailwind's own dark variant, which this project does not switch on. */
const OS_DARK = /\bdark:[a-z-]+\b/g;

/**
 * Lines that name a third party's own colour. A social button that hovers in
 * the network's blue is the mark, not the theme.
 */
function isBrandMark(line: string): boolean {
    return /aria-label="(?:Facebook|Instagram|X \(Twitter\)|YouTube|Twitch|TikTok|Discord)"/.test(line);
}

function coreRoots(): string[] {
    const roots = [
        join(ROOT, "src/app/[locale]/(admin)"),
        join(ROOT, "src/app/[locale]/(public)"),
        join(ROOT, "src/app/[locale]/page.tsx"),
        join(ROOT, "src/app/[locale]/HomeWelcome.tsx"),
        join(ROOT, "src/core/components/admin"),
        join(ROOT, "src/core/components/layout"),
        join(ROOT, "src/core/components/ui"),
    ];
    const sources = join(ROOT, "module-sources");
    if (existsSync(sources)) {
        for (const entry of readdirSync(sources)) {
            // Everything a module draws: its admin screens, its public pages,
            // and the components, slots and widgets it hangs in core's chrome.
            for (const surface of ["pages", "components", "slots", "widgets"]) {
                const dir = join(sources, entry, surface);
                if (existsSync(dir)) roots.push(dir);
            }
        }
    }
    return roots.filter((r) => existsSync(r));
}

function tsxFiles(dir: string, into: string[] = []): string[] {
    // A root may name one file rather than a directory.
    if (!statSync(dir).isDirectory()) {
        if (dir.endsWith(".tsx")) into.push(dir);
        return into;
    }
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) tsxFiles(full, into);
        else if (entry.endsWith(".tsx")) into.push(full);
    }
    return into;
}

/** Class names only. A doc comment may name the class it replaced. */
function classAttributes(source: string): string {
    return source
        .split("\n")
        .filter((line) => !/^\s*(?:\*|\/\/|\/\*)/.test(line))
        .filter((line) => !isBrandMark(line))
        .join("\n");
}

describe("core's own screens", () => {
    const files = coreRoots().flatMap((r) => tsxFiles(r));

    it("has screens to check", () => {
        expect(files.length).toBeGreaterThan(250);
    });

    it("names no fixed colour from Tailwind's palette", () => {
        const offenders: string[] = [];
        for (const file of files) {
            const hits = classAttributes(readFileSync(file, "utf-8")).match(FIXED);
            if (hits) offenders.push(`${file.slice(ROOT.length + 1)}: ${[...new Set(hits)].join(", ")}`);
        }
        expect(offenders).toEqual([]);
    });

    it("hovers on a surface colour, never on the brand accent", () => {
        // `hover:bg-accent` is a shadcn habit, where `accent` is a faint grey
        // and comes with `accent-foreground`. Here `accent` is a brand colour
        // a theme picks - Flat's is a saturated orange - so five controls
        // turned bright orange under the cursor while their text stayed the
        // colour it was. Every button in the panel hovers on `muted`.
        const offenders: string[] = [];
        for (const file of files) {
            const hits = classAttributes(readFileSync(file, "utf-8")).match(/hover:bg-accent(\/\d+)?\b/g);
            if (hits) offenders.push(`${file.slice(ROOT.length + 1)}: ${[...new Set(hits)].join(", ")}`);
        }
        expect(offenders, "use hover:bg-muted").toEqual([]);
    });

    it("does not reach for the `dark:` variant, which never fires here", () => {
        const offenders: string[] = [];
        for (const file of files) {
            const hits = classAttributes(readFileSync(file, "utf-8")).match(OS_DARK);
            if (hits) offenders.push(`${file.slice(ROOT.length + 1)}: ${[...new Set(hits)].join(", ")}`);
        }
        expect(offenders).toEqual([]);
    });
});
