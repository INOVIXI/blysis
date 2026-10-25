/**
 * Kite's missing page: what happened, a search of the site and the way
 * home, beside a kite drifting off on a broken string.
 *
 * The words are the ones core read and handed in, because the database may
 * be why the page is missing. Home is a plain anchor, as core's own is, since
 * the page may be drawn when routing is what failed, and the search is an
 * ordinary form that works before any script has run.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/core/sdk/ui", async () => {
    const button = await import("@/core/components/ui/button");
    return { buttonClassName: button.buttonClassName, Input: (props: React.ComponentProps<"input">) => <input {...props} /> };
});

const { default: NotFound } = await import("@/themes/kite/components/NotFound");

const WORDS = {
    title: "Page not found",
    description: "Nothing lives at this address.",
    goHome: "Go home",
    homeHref: "/en",
    search: "Search the site",
    searchHref: "/en/search",
};

describe("a wrong turn on Kite", () => {
    it("says what happened in the words core handed in", () => {
        render(<NotFound {...WORDS} />);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(WORDS.title);
        expect(screen.getByText(WORDS.description)).toBeTruthy();
    });

    it("searches the site with a form that needs no script", () => {
        render(<NotFound {...WORDS} />);
        const form = screen.getByRole("search");
        expect(form.getAttribute("action")).toBe(WORDS.searchHref);
        expect(form.getAttribute("method")).toBe("get");
        expect(screen.getByRole("searchbox", { name: WORDS.search }).getAttribute("name")).toBe("q");
        expect(screen.getByRole("button", { name: WORDS.search }).getAttribute("type")).toBe("submit");
    });

    it("goes home through a plain anchor", () => {
        render(<NotFound {...WORDS} />);
        expect(screen.getByRole("link", { name: WORDS.goHome }).getAttribute("href")).toBe(WORDS.homeHref);
    });

    it("leaves the description out when core had none", () => {
        const { container } = render(<NotFound {...WORDS} description="" />);
        expect(container.querySelector(".kt-lost-lede")).toBeNull();
    });
});
