import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A create or edit form used to unfold as a card above the list it belongs to.
 *
 * On a screen with two hundred roles that pushes the row you came to edit off
 * the bottom of the page. The browser's back button does not close it. A form
 * you are halfway through cannot be reloaded, linked, or reopened where you
 * left it, because nothing about it is in the URL. And the same screen is now
 * two screens wearing one address, so "where am I" has no answer.
 *
 * A create screen is a place, so it has an address: `/admin/roles/new`,
 * `/admin/roles/<id>/edit`, and - for the generic CRUD screen that thirteen
 * modules render, whose field definitions live in each module's own page file
 * - `?form=new` and `?form=<id>` on the screen's own path.
 *
 * A modal counts as the old shape too. It is still the same screen wearing
 * one address: nothing about it is in the URL, so it cannot be linked,
 * reloaded, or closed with the back button either.
 *
 * The gate bans a list screen holding a piece of state that decides whether a
 * form appears on top of it - in core and in every module's admin screens.
 */

const ROOTS = ["src/app", "src/core", "module-sources"];

/**
 * The state names that used to gate an inline create or edit card, or the
 * modal that replaced one.
 *
 * A list of names catches the shapes somebody has already written and misses
 * the next synonym. The broadcast screen called its flag `composing` and sat
 * here unnoticed through every run of this gate: the whole composer unfolded
 * over the list, with nothing in the address. So the names are the first
 * question and `unfoldsAForm` below is the second.
 */
const INLINE_FORM_STATE =
    /const \[\s*(?:show[A-Z]?\w*Form|showNew|showCreate|showModal|showDialog|modalOpen|dialogOpen|editing\w*)\s*,/;

/** A boolean this file declares and renders a form behind. */
const BOOLEAN_STATE = /const \[\s*(\w+)\s*,\s*set\w+\s*\] = useState(?:<[^>]*>)?\(\s*false\s*\)/g;
const WRITES = /method:\s*["'](?:POST|PATCH|PUT)["']/;

/** The file draws rows, so a form on it is a form over a list. */
function drawsAList(source: string): boolean {
    for (const m of source.matchAll(/\.map\(/g)) {
        const body = source.slice(m.index ?? 0, (m.index ?? 0) + 1500);
        if (/key=\{/.test(body) && /<tr\b|<li\b|<Card\b|divide-y/.test(body)) return true;
    }
    return false;
}

/**
 * A list screen that hides a form behind a flag of its own, whatever the flag
 * is called.
 *
 * The form has to be a form and not a disclosure: a section of extra settings
 * behind a "show advanced" toggle is one screen, and so is a panel that
 * appears once something is chosen. What marks a create screen is that the
 * same file also sends a write.
 */
function unfoldsAForm(source: string): string | null {
    if (!drawsAList(source) || !WRITES.test(source)) return null;
    for (const m of source.matchAll(BOOLEAN_STATE)) {
        const name = m[1];
        for (const g of source.matchAll(new RegExp(`\\{${name}\\s*&&\\s*\\(`, "g"))) {
            const open = (g.index ?? 0) + g[0].length - 1;
            const hidden = behind(source, open);
            /*
             * A dialog is not a create screen unfolded. The admin's own
             * account-deletion dialog asks the operator to type a username
             * before it will go ahead, so it holds an `<Input>` - and what it
             * is is a confirmation, which belongs over the page rather than
             * as a page. It announces itself as one.
             */
            if (/role="dialog"|aria-modal|<ModalLayer\b/.test(hidden)) continue;
            if (/<Input\b|<Textarea\b|<RichTextEditor\b/.test(hidden)) return name;
        }
    }
    return null;
}

/**
 * What the flag actually hides: from its `(` to the matching `)`.
 *
 * This was "the next two thousand five hundred characters", which is the same
 * fixed-window mistake two other gates in this directory record having fixed.
 * It reported the punishments screen, where a one-line `{scopesUnread && (<p
 * .../>)}` sits a few hundred characters above the duration box - a sibling,
 * not something the flag hides. A window cannot tell those apart; the
 * brackets can.
 */
function behind(source: string, open: number): string {
    let depth = 0;
    let quote: string | null = null;
    for (let i = open; i < source.length; i++) {
        const c = source[i];
        if (quote) {
            if (c === "\\") { i++; continue; }
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "(") depth++;
        else if (c === ")") { depth--; if (depth === 0) return source.slice(open, i + 1); }
    }
    return source.slice(open);
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (full.endsWith(".tsx")) out.push(full);
    }
    return out;
}

const files = ROOTS.flatMap((root) => walk(root));

/**
 * A dialog that is genuinely a dialog - a confirmation, a picker, a viewer of
 * something already on the screen - is not a create screen and stays where it
 * is. Each entry says which.
 */
const ALLOWLIST: Record<string, string> = {
    "module-sources/suggestions/components/SuggestionBoard.tsx":
        "a public compose box, not an admin create screen: three fields a visitor fills in place while reading the board, and sending them to a separate page to type two sentences would lose the list they were reading",
    "src/app/[locale]/(admin)/admin/users/[id]/MemberRestrictions.tsx":
        "three fields on one member's own screen, about that member. The list beside them is their restrictions, and sending an operator to another address to type a reason would lose the person they are looking at",
    "module-sources/suggestions/pages/public/[id]/page.tsx":
        "the flag is `truncated`, which says a discussion was cut short. The reply box the scan sees below it is the page's own, not something the flag unfolds",
};

describe("a create screen is a place", () => {
    it("holds no inline create or edit form, in core or in any module", () => {
        const offenders = files.filter(
            (file) => !ALLOWLIST[file] && INLINE_FORM_STATE.test(readFileSync(file, "utf8")),
        );
        expect(offenders).toEqual([]);
    });

    it("holds none under a name nobody thought of either", () => {
        const offenders: string[] = [];
        for (const file of files) {
            if (ALLOWLIST[file]) continue;
            const flag = unfoldsAForm(readFileSync(file, "utf8"));
            if (flag) offenders.push(`${file}: ${flag}`);
        }
        expect(offenders).toEqual([]);
    });

    it("gives every allowlist entry a reason", () => {
        for (const [file, reason] of Object.entries(ALLOWLIST)) {
            expect(files, `${file} is allowlisted but does not exist`).toContain(file);
            expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(40);
        }
    });

    it("routes the module form screens through the shared hook", () => {
        const screens = [
            "module-sources/blog/pages/admin/categories/page.tsx",
            "module-sources/custom-forms/pages/admin/page.tsx",
            "module-sources/custom-pages/pages/admin/page.tsx",
            "module-sources/forum/pages/admin/categories/page.tsx",
            "module-sources/help-center/pages/admin/help/page.tsx",
            "module-sources/license-keys/pages/admin/licenses/page.tsx",
            "module-sources/punishments/pages/admin/page.tsx",
            "module-sources/store/pages/admin/categories/page.tsx",
            "module-sources/store/pages/admin/coupons/page.tsx",
            "module-sources/store/pages/admin/gift-codes/page.tsx",
            "module-sources/trophies/pages/admin/page.tsx",
        ];
        for (const screen of screens) {
            const src = readFileSync(screen, "utf8");
            expect(src, `${screen} does not use useFormRoute`).toContain("useFormRoute");
            // `showSomethingForm` on the screens that edit one kind of thing,
            // and the thing itself on the one that edits two: the help centre
            // opens an article form or a category form from one address, so
            // its guard holds which and on what rather than a boolean. Either
            // way the form is returned above the list instead of unfolding
            // inside it, which is the whole of what this asks.
            expect(src, `${screen} never returns the form as its own screen`).toMatch(
                /if \((?:show\w*(?:Form|Create)|\w*[Tt]arget)\) \{/,
            );
        }
    });

    it("keeps a two pane editor's selection in the address too", () => {
        // The SEO screen is not a list with a form over it: the site is down
        // the left and one page's head is always open on the right, so there
        // is no form to show or hide. The rule this file defends is that the
        // thing being edited has an address, and `?page=` is that address -
        // reloadable, linkable, and closed by the back button.
        const src = readFileSync("module-sources/seo/pages/admin/pages/page.tsx", "utf8");
        expect(src).toContain('searchParams?.get("page")');
        expect(src).toContain("router.push(`${pathname}?page=");
    });

    it("exports the hook to modules", () => {
        // A module cannot reach into @/core/hooks; the boundary allows the SDK
        // barrels only, so the hook has to be re-exported from one of them.
        const sdk = readFileSync("src/core/sdk/ui.ts", "utf8");
        expect(sdk).toContain("useFormRoute");
    });

    it("gives the core create screens their own routes", () => {
        const routes = [
            "src/app/[locale]/(admin)/admin/roles/new/page.tsx",
            "src/app/[locale]/(admin)/admin/roles/[id]/edit/page.tsx",
            "src/app/[locale]/(admin)/admin/api-keys/new/page.tsx",
            "src/app/[locale]/(admin)/admin/ip-blocks/new/page.tsx",
            "src/app/[locale]/(admin)/admin/warnings/new/page.tsx",
        ];
        for (const route of routes) {
            expect(files, `${route} is missing`).toContain(route);
        }
    });

    it("links to those routes from the list screens", () => {
        const pairs: [string, string][] = [
            ["roles", "/admin/roles/new"],
            ["api-keys", "/admin/api-keys/new"],
            ["ip-blocks", "/admin/ip-blocks/new"],
            ["warnings", "/admin/warnings/new"],
        ];
        for (const [screen, href] of pairs) {
            const src = readFileSync(`src/app/[locale]/(admin)/admin/${screen}/page.tsx`, "utf8");
            expect(src, `${screen} still opens its form in place`).toContain(href);
        }
    });

    it("puts the shared CRUD form on its own address too", () => {
        const src = readFileSync("src/core/components/admin/AdminCrudPage.tsx", "utf8");
        expect(src).toContain("useFormRoute()");
        // The form replaces the list rather than sitting above it.
        expect(src).toContain("if (showForm) {");
    });

    it("reads the address in one place", () => {
        // Thirteen module screens render AdminCrudPage and twelve more roll
        // their own; `?form=` is parsed by the hook, not by each of them.
        const callers = files.filter(
            (file) =>
                file !== "src/core/hooks/useFormRoute.ts" &&
                readFileSync(file, "utf8").includes('searchParams.get("form")'),
        );
        expect(callers).toEqual([]);
    });

    it("does not leave the user search written twice", () => {
        const callers = files.filter((file) =>
            readFileSync(file, "utf8").includes("/api/v1/users?search="),
        );
        expect(callers).toEqual(["src/core/components/admin/UserPicker.tsx"]);
    });
});
