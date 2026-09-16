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
 */
const INLINE_FORM_STATE =
    /const \[\s*(?:show[A-Z]?\w*Form|showNew|showCreate|showModal|showDialog|modalOpen|dialogOpen|editing\w*)\s*,/;

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
};

describe("a create screen is a place", () => {
    it("holds no inline create or edit form, in core or in any module", () => {
        const offenders = files.filter(
            (file) => !ALLOWLIST[file] && INLINE_FORM_STATE.test(readFileSync(file, "utf8")),
        );
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
            expect(src, `${screen} never returns the form as its own screen`).toMatch(
                /if \(show\w*(?:Form|Create)\) \{/,
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
            "src/app/[locale]/(admin)/admin/resource-permissions/new/page.tsx",
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
            ["resource-permissions", "/admin/resource-permissions/new"],
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
