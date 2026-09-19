import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * An admin screen says what it is, and says it the same way everywhere.
 *
 * `AdminPageHeader` draws the title, the description, the back link and the
 * row of actions, and the breadcrumb above it reads the same route. A screen
 * that rolls its own `<h1>` gets a different size, a different gap under it,
 * its buttons somewhere else, and a back link that may or may not exist -
 * which is what the panel used to look like, and what a hundred and forty
 * screens across core and seventy-eight modules would drift back into one
 * page at a time.
 *
 * Most module screens never name the header at all: they hand a title and a
 * subtitle to `AdminCrudPage`, `SettingsForm` or `AuthProviderSetup`, and
 * those draw it. That is the better arrangement - a module says what its
 * screen is called and core decides what a screen looks like - so it counts
 * here, and this test also holds those three to using the header themselves.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Shells that draw the header on their caller's behalf. */
const SHELLS = ["AdminCrudPage", "SettingsForm", "AuthProviderSetup", "AdminPageHeader"];

/**
 * A screen that fills the viewport with an editor of its own would be given a
 * second toolbar by the panel header, so it would go here. The one member
 * this set ever had was the block page builder, and that is gone; the empty
 * set stays because the next full-screen editor will want it, and the test
 * below refuses a member that is not really one.
 */
const FULL_SCREEN = new Set<string>([]);

/**
 * Not a screen at all. `/admin/[...slug]` is where a module's admin page is
 * mounted: it checks the session, matches the route and renders the module's
 * own component, which is in this list and is checked like any other.
 */
const MOUNT_POINTS = new Set(["src/app/[locale]/(admin)/admin/[...slug]/page.tsx"]);

const EXEMPT = new Set([...FULL_SCREEN, ...MOUNT_POINTS]);

function adminPages(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules") walk(full);
            } else if (entry.name === "page.tsx") {
                found.push(full);
            }
        }
    };
    walk(path.join(ROOT, "src/app/[locale]/(admin)/admin"));
    for (const id of fs.readdirSync(path.join(ROOT, "module-sources"))) {
        walk(path.join(ROOT, "module-sources", id, "pages/admin"));
    }
    return found;
}

/**
 * A page that only renders another component of its own is titled by that one.
 *
 * Both spellings of "another component of its own" count: a relative import,
 * and an `@/` one. Reading only the relative form meant a page that handed
 * its whole body to a core component - `@/core/components/...` - looked
 * untitled even though that component drew the header.
 */
function ownComponents(file: string): string[] {
    const source = fs.readFileSync(file, "utf8");
    const relative = [...source.matchAll(/from\s+"(\.[^"]+)"/g)].map((m) =>
        path.resolve(path.dirname(file), m[1]),
    );
    const aliased = [...source.matchAll(/from\s+"@\/([^"]+)"/g)].map((m) =>
        path.join(ROOT, "src", m[1]),
    );
    return [...relative, ...aliased];
}

function titled(file: string, seen = new Set<string>()): boolean {
    if (seen.has(file)) return false;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    if (SHELLS.some((shell) => source.includes(shell))) return true;
    for (const base of ownComponents(file)) {
        for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx")]) {
            if (fs.existsSync(candidate) && titled(candidate, seen)) return true;
        }
    }
    return false;
}

/**
 * A page whose whole job is to send the reader somewhere else.
 *
 * `/admin/settings` is a group of sections with nothing of its own; the path
 * an operator remembers answered 404 until it got a page that redirects to
 * the first section. Such a page renders no markup at all, so it has no
 * header to wear. That is a property of the file rather than an exception
 * somebody has to remember, so it is read rather than listed.
 */
function onlyRedirects(file: string): boolean {
    const source = stripComments(fs.readFileSync(file, "utf8"));
    if (!/\bredirect\s*\(/.test(source)) return false;
    return !/<[A-Za-z]/.test(source);
}

describe("an admin screen", () => {
    const pages = adminPages();

    it("finds the screens", () => {
        expect(pages.length).toBeGreaterThan(120);
    });

    it("takes its title from the one header, directly or through a shell", () => {
        const untitled = pages
            .map((file) => path.relative(ROOT, file))
            .filter((rel) => !EXEMPT.has(rel))
            .filter((rel) => !onlyRedirects(path.join(ROOT, rel)))
            .filter((rel) => !titled(path.join(ROOT, rel)));
        expect(untitled).toEqual([]);
    });

    it("does not roll its own page title", () => {
        const rolled = pages
            .map((file) => path.relative(ROOT, file))
            .filter((rel) => !EXEMPT.has(rel))
            .filter((rel) => /<h1\b/.test(fs.readFileSync(path.join(ROOT, rel), "utf8")));
        expect(rolled).toEqual([]);
    });

    it("gives the header the whole row, because it lays out that row itself", () => {
        /*
         * The header is `justify-between`: the title on the left, the back
         * link and the actions on the right. That only separates them while
         * the header is as wide as the page. Put it inside a flex row of its
         * own and it becomes a flex item, shrinks to its contents, and the
         * separation collapses - which is how the product editor ended up
         * with Back, Delete and Save pressed against the word "Edit product"
         * in the middle of an otherwise empty line.
         *
         * Nothing about it looks broken in the source, so it is read here.
         */
        const boxed: string[] = [];
        for (const file of pages) {
            const source = stripComments(fs.readFileSync(file, "utf8"));
            // A JSX comment leaves its braces behind when the comment inside
            // it goes, and one sits between the wrapper and the header.
            const wrapped = /<div className="([^"]*\bflex\b[^"]*)"[^>]*>\s*(?:\{\s*\}\s*)?<AdminPageHeader/.exec(source);
            if (wrapped) boxed.push(`${path.relative(ROOT, file)}: ${wrapped[1]}`);
        }
        expect(boxed).toEqual([]);
    });

    it("keeps the exception list to screens that really are full-screen", () => {
        // A screen claiming to own the viewport draws over the panel's chrome
        // and says so in its own class list; one that does not is a screen
        // that simply forgot its header.
        for (const rel of FULL_SCREEN) {
            const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
            expect(source, rel).toMatch(/h-screen|inset-0|fixed/);
        }
    });

    it("keeps the mount point exempt only while it stays a mount point", () => {
        for (const rel of MOUNT_POINTS) {
            const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
            // It renders whatever the registry resolved, and nothing else.
            // The registry it reads is the admin one: the two surfaces were
            // one map that both mount points imported, so every public module
            // page first-loaded all 110 admin screens.
            expect(source, rel).toContain("ModuleAdminRegistry[match.key]");
            expect(source, rel).toContain("<Component");
        }
    });
});

describe("the shells a module hands its title to", () => {
    for (const shell of ["AdminCrudPage", "SettingsForm", "AuthProviderSetup"]) {
        it(`${shell} draws the header itself`, () => {
            const file = path.join(ROOT, `src/core/components/admin/${shell}.tsx`);
            const source = fs.readFileSync(file, "utf8");
            expect(source).toContain("AdminPageHeader");
            expect(source).toMatch(/title[:=]/);
        });
    }
});
