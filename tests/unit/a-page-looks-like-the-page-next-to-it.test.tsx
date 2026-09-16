/**
 * Every public page is built from one frame, so they line up with each other.
 *
 * Each module wrote its own page shell by hand. Measured across the 31 public
 * pages on 2026-09-08: nine different content widths (max-w-2xl through
 * max-w-5xl and none at all), a breadcrumb on nine of them, two backgrounds,
 * and two page titles carrying an icon nobody else's title had. Nothing was
 * broken; the site simply looked like nine sites, and moving between Blog and
 * Trophies moved the left edge of the text.
 *
 * The frame owns what a visitor reads as "the page": the measure, the crumb
 * trail, the title, and where the sidebar column starts. A module supplies
 * what is inside it. That is the only way a rule like "one width" survives
 * the next module.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";
import { pageSource } from "./module-page-source";

vi.mock("@/core/components/layout", () => ({
    Navbar: () => <nav data-testid="navbar" />,
    Footer: () => <footer data-testid="footer" />,
}));
vi.mock("@/core/components/theme/ThemeComponentSlot", () => ({
    ThemeComponentSlot: () => null,
}));
// next-intl's client navigation cannot be resolved under vitest's jsdom
// environment, and what it adds - the locale prefix on every href - is
// guaranteed by navigation-keeps-the-visitors-locale.test.ts. Here the link is
// a link, so the assertions below are about the trail the frame builds.
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a href={href} {...rest}>{children}</a>
    ),
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const { PageFrame } = await import("@/core/components/layout/PageFrame");

function draw(ui: React.ReactNode) {
    return render(<NextIntlClientProvider locale="en" messages={MESSAGES}>{ui}</NextIntlClientProvider>);
}

describe("a public page", () => {
    it("names itself once, as a heading", () => {
        draw(<PageFrame title="Trophies">body</PageFrame>);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Trophies");
    });

    it("says where the reader is, starting from the home page", () => {
        draw(<PageFrame title="Trophies">body</PageFrame>);
        const trail = screen.getByRole("navigation", { name: /breadcrumb/i });
        expect(within(trail).getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
        expect(trail.textContent).toContain("Trophies");
    });

    it("carries the steps between home and here, in order", () => {
        draw(
            <PageFrame title="New ticket" trail={[{ label: "Support", href: "/support" }]}>
                body
            </PageFrame>,
        );
        const trail = screen.getByRole("navigation", { name: /breadcrumb/i });
        expect(within(trail).getByRole("link", { name: "Support" }).getAttribute("href")).toBe("/support");
        expect(trail.textContent?.replace(/\s+/g, " ")).toMatch(/Home\s*\/\s*Support\s*\/\s*New ticket/);
        // The page it is on is where the reader already is, so it is not a link.
        expect(within(trail).queryByRole("link", { name: "New ticket" })).toBeNull();
    });

    it("measures the same whatever the page, because the frame owns the measure", () => {
        const { container } = draw(<PageFrame title="Trophies">body</PageFrame>);
        const main = container.querySelector("main") as HTMLElement;
        expect(main.className).toContain("container");
        expect(main.className).not.toMatch(/max-w-/);
    });

    it("starts the sidebar level with the content, not level with the title", () => {
        // The widget column used to begin at the top of the page while the
        // content column began under a breadcrumb and a heading, so every
        // widget card sat a heading's height above the first article card.
        const { container } = draw(
            <PageFrame title="Blog" sidebar={<div data-testid="widget" />}>
                <div data-testid="content" />
            </PageFrame>,
        );
        const columns = container.querySelector("[data-sidebar-layout]") as HTMLElement;
        const heading = screen.getByRole("heading", { level: 1 });

        expect(columns.contains(heading)).toBe(false);
        expect(heading.compareDocumentPosition(columns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(within(columns).getByTestId("widget")).toBeTruthy();
        expect(within(columns).getByTestId("content")).toBeTruthy();
    });

    it("gives the page its chrome, so no page has to remember to", () => {
        draw(<PageFrame title="Trophies">body</PageFrame>);
        expect(screen.getByTestId("navbar")).toBeTruthy();
        expect(screen.getByTestId("footer")).toBeTruthy();
    });

    it("puts the controls that belong to the page beside its title", () => {
        draw(
            <PageFrame title="Suggestions" actions={<button type="button">New suggestion</button>}>
                body
            </PageFrame>,
        );
        expect(screen.getByRole("button", { name: "New suggestion" })).toBeTruthy();
    });
});

/**
 * The rule only holds while every page keeps using the frame, and a new
 * module is written by copying an old one. This is the copy it should find.
 */
describe("the public pages, core's own and the modules'", () => {
    const ROOT = process.cwd();

    /**
     * Pages that are deliberately not the standard page shell. Each line is a
     * decision; the list may shrink and should not grow.
     */
    const NOT_A_PAGE: Record<string, string> = {
        "module-sources/store/pages/public/order-success/page.tsx":
            "A checkout confirmation, drawn centred in the viewport. It is the end of a flow rather than somewhere to browse from, so it carries no crumb trail back through a store it has just left.",
        "module-sources/steam-auth/pages/auth/steam/page.tsx":
            "The screen a Steam sign-in returns through. It has no chrome at all because it exists to hand off to a redirect.",
    };

    function publicPages(): string[] {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === "admin") continue;
                    walk(full);
                } else if (entry.name === "page.tsx") {
                    out.push(path.relative(ROOT, full));
                }
            }
        };
        for (const moduleId of fs.readdirSync(path.join(ROOT, "module-sources"))) {
            const pages = path.join(ROOT, "module-sources", moduleId, "pages");
            if (fs.existsSync(pages)) walk(pages);
        }
        /*
         * Core's own browsable pages, which this used to leave out - and they
         * had drifted exactly as the modules once did, because nothing was
         * looking. Measured on 2026-09-15: three pages, three widths, none of
         * them the frame's and none carrying a crumb trail.
         *
         * `(auth)`, `(setup)` and `maintenance` stay outside it on purpose:
         * they are flows and failures rather than somewhere to browse from,
         * the same reason the store's order-success screen is listed above.
         */
        walk(path.join(ROOT, "src/app/[locale]/(public)"));
        return out.sort();
    }

    const pages = publicPages();

    it("finds pages to check, so a broken scan cannot pass quietly", () => {
        expect(pages.length).toBeGreaterThan(20);
    });

    /**
     * The page's own code, plus the module component it hands the screen to.
     *
     * A page that reads its subject on the server is a short file that
     * renders one client component, and the frame is in that component.
     * Following the import keeps the rule about the frame rather than
     * exempting the file: the list above is for pages that really draw no
     * frame, and it should not collect an entry every time a page moves its
     * fetch to the server.
     */
    function frameSource(page: string): string {
        const moduleRoot = path.join(ROOT, page.split("/").slice(0, 2).join("/"));
        return stripComments(pageSource(path.join(ROOT, page), moduleRoot));
    }

    /** The file's code, without its prose. A comment naming `<main>` is not one. */
    function code(page: string): string {
        return stripComments(fs.readFileSync(path.join(ROOT, page), "utf8"));
    }

    it("draws every one of them in the frame", () => {
        const freehand = pages.filter((p) => !NOT_A_PAGE[p] && !frameSource(p).includes("<PageFrame"));
        expect(freehand).toEqual([]);
    });

    it("lets none of them set a width of its own", () => {
        // The measure is the frame's. A page that reaches for `container` or
        // a max-w on a page-level element is building a second shell.
        const offenders: string[] = [];
        for (const page of pages) {
            if (NOT_A_PAGE[page]) continue;
            const source = code(page);
            if (/<main\b/.test(source)) offenders.push(`${page}: writes its own <main>`);
            if (/className="container/.test(source)) offenders.push(`${page}: sets its own container`);
        }
        expect(offenders).toEqual([]);
    });

    it("lets none of them draw the chrome, which is how two of them drifted apart", () => {
        const offenders: string[] = [];
        for (const page of pages) {
            if (NOT_A_PAGE[page]) continue;
            const source = code(page);
            for (const own of ["<Navbar", "<Footer", "min-h-screen"]) {
                if (source.includes(own)) offenders.push(`${page}: ${own}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("keeps the exception list to pages that exist", () => {
        for (const page of Object.keys(NOT_A_PAGE)) {
            expect(fs.existsSync(path.join(ROOT, page)), page).toBe(true);
        }
    });
});
