/**
 * A phone reaches everything the navigation offers.
 *
 * Measured on 2026-09-11 with 89 modules installed: the navbar offered eight
 * links and folded the rest into a "More" dropdown, and a phone got neither.
 * It got a bottom bar holding Home, the first three module links in registry
 * order, and Profile - five slots for a site with forty-four module screens.
 * Everything else was reachable only by scrolling to a footer that measured
 * 670px of a 1933px page, and the footer listed nine of them.
 *
 * Nothing about that looked broken. The bar was full, the pages existed, and
 * which three modules won the slots depended on the order a registry happened
 * to enumerate.
 *
 * So the bar is gone and a phone gets the whole list, in a panel. The rule
 * that matters is the one below: what the navigation offers is what a phone
 * can reach, with no arithmetic in between.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a href={href} {...rest}>{children}</a>
    ),
    usePathname: () => "/",
}));
vi.mock("@/core/components/Slot", () => ({ Slot: () => null }));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const { MobileMenu } = await import("@/core/components/layout/MobileMenu");
const { FooterColumn } = await import("@/core/components/layout/FooterColumn");

/** More links than the bar draws inline, so a folded list would show. */
const LINKS = Array.from({ length: 12 }, (_, i) => ({
    label: `Section ${i + 1}`,
    href: `/section-${i + 1}`,
    icon: "Package",
}));

function draw(links = LINKS) {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <MobileMenu links={links} />
        </NextIntlClientProvider>,
    );
}

function open() {
    fireEvent.click(screen.getByRole("button", { name: MESSAGES.nav.menu }));
}

describe("the menu a phone opens", () => {
    it("offers every link, not the ones that fit a bar", () => {
        draw();
        open();
        for (const link of LINKS) {
            expect(screen.getByRole("link", { name: link.label }).getAttribute("href")).toBe(link.href);
        }
    });

    it("offers the children of a folded group as links of their own", () => {
        draw([
            { label: "Shop", href: "/shop", icon: "Package" },
            {
                label: "More", href: "#", icon: "MoreHorizontal",
                children: [{ label: "Trophies", href: "/trophies" }],
            } as (typeof LINKS)[number],
        ]);
        open();
        expect(screen.getByRole("link", { name: "Trophies" }).getAttribute("href")).toBe("/trophies");
        // A dropdown placeholder is not a place. It used to render as a link
        // to "#", which on a phone is a tap that does nothing.
        expect(screen.queryByRole("link", { name: "More" })).toBeNull();
    });

    it("is a dialog, so a keyboard can leave it", () => {
        draw();
        open();
        expect(screen.getByRole("dialog")).toBeTruthy();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("stays shut until it is asked for", () => {
        draw();
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

describe("the page under the menu", () => {
    it("reserves no room for a bar that is gone", () => {
        const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
        expect(css).not.toContain("mobile-nav-height");
    });
});

describe("a footer column on a phone", () => {
    /**
     * Measured on 2026-09-11 at 390px: the footer was 670px of a 1933px page,
     * a third of it, because every column stacks into one and each link is a
     * 56px row. A visitor scrolling to the end of an article met a second
     * navigation they had not asked for.
     */
    function drawColumn() {
        return render(
            <NextIntlClientProvider locale="en" messages={MESSAGES}>
                <FooterColumn title="Quick Links">
                    <span>Blog</span>
                </FooterColumn>
            </NextIntlClientProvider>,
        );
    }

    it("starts folded, and says so", () => {
        drawColumn();
        const heading = screen.getByRole("button", { name: /Quick Links/ });
        expect(heading.getAttribute("aria-expanded")).toBe("false");
    });

    it("opens when its heading is pressed", () => {
        drawColumn();
        fireEvent.click(screen.getByRole("button", { name: /Quick Links/ }));
        expect(screen.getByRole("button", { name: /Quick Links/ }).getAttribute("aria-expanded")).toBe("true");
    });

    it("is only a button where it folds, and words alone where it does not", () => {
        drawColumn();
        const heading = screen.getByRole("heading", { name: /Quick Links/ });
        const words = heading.querySelector(":scope > span");
        expect(words?.textContent).toBe("Quick Links");
        expect(words?.className).toContain("hidden sm:inline");
        expect(screen.getByRole("button", { name: /Quick Links/ }).className).toContain("sm:hidden");
    });

    it("is still a heading, so the page keeps its outline", () => {
        drawColumn();
        expect(screen.getByRole("heading", { name: /Quick Links/ })).toBeTruthy();
    });
});
