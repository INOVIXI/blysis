/**
 * Quarry's missing page is a signpost: home first, then the first of the
 * site's own links, each board pointing the other way from the last, and a
 * search under the words.
 *
 * Home is a plain anchor because the page may be drawn when routing is what
 * failed. A link with a menu under it points at what is in the menu, since
 * the menu's own label leads nowhere; the bar's home link is not a second
 * board saying the same as the first.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ links: [] as { href: string; label: string; children?: { href: string; label: string }[] }[] }));

vi.mock("@/core/sdk/theme", () => ({ useNavLinks: () => ({ links: nav.links }) }));
vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} data-routed="" {...rest}>{children}</a>,
}));
vi.mock("@/core/sdk/ui", async () => {
    const button = await import("@/core/components/ui/button");
    return { buttonClassName: button.buttonClassName, Input: (props: React.ComponentProps<"input">) => <input {...props} /> };
});

const { default: NotFound } = await import("@/themes/quarry/components/NotFound");

const WORDS = {
    title: "Page not found",
    description: "Nothing lives at this address.",
    goHome: "Go home",
    homeHref: "/en",
    search: "Search the site",
    searchHref: "/en/search",
};

function boards() {
    return [...screen.getByRole("navigation", { name: WORDS.goHome }).querySelectorAll("a")];
}

describe("a wrong turn on Quarry points the way back", () => {
    it("puts home on the first board, as a plain anchor, then the site's own links", () => {
        nav.links = [
            { href: "/", label: "Home" },
            { href: "/store", label: "Store" },
            { href: "/forum", label: "Forum" },
        ];
        render(<NotFound {...WORDS} />);

        expect(boards().map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
            ["Go home", "/en"],
            ["Store", "/store"],
            ["Forum", "/forum"],
        ]);
        expect(boards()[0].hasAttribute("data-routed")).toBe(false);
        expect(boards()[1].hasAttribute("data-routed")).toBe(true);
    });

    it("points each board the other way from the one above it, and stops at four", () => {
        nav.links = ["a", "b", "c", "d", "e"].map((id) => ({ href: `/${id}`, label: id }));
        render(<NotFound {...WORDS} />);

        expect(boards().map((a) => a.getAttribute("data-side"))).toEqual(["right", "left", "right", "left"]);
    });

    it("points at what is in a menu rather than at the menu's label", () => {
        nav.links = [{ href: "#", label: "Community", children: [{ href: "/vote", label: "Vote" }, { href: "/staff", label: "Staff" }] }];
        render(<NotFound {...WORDS} />);

        expect(boards().map((a) => a.textContent)).toEqual(["Go home", "Vote", "Staff"]);
    });

    it("searches the site by its own search page, with the words in q", () => {
        nav.links = [];
        render(<NotFound {...WORDS} />);

        const form = screen.getByRole("search");
        expect(form.getAttribute("action")).toBe("/en/search");
        expect(form.getAttribute("method")).toBe("get");
        expect(screen.getByLabelText(WORDS.search, { selector: "input" }).getAttribute("name")).toBe("q");
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(WORDS.title);
    });
});
