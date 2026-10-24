/**
 * An article can list its own sections beside it.
 *
 * A long article is read by jumping: the reader wants the part about the
 * economy, not the three screens before it. The headings the writer put in
 * are the sections, so the list is read from the article as drawn, each
 * heading given an address to jump to, in the order they stand. An article
 * of fewer than two sections has nothing to list and shows nothing.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const { ArticleContents } = await import("@/modules/blog/components/ArticleContents");

function article(headings: [string, string][]) {
    return (
        <>
            <ArticleContents />
            <div data-article-body>
                {headings.map(([level, text]) => React.createElement(level, { key: text }, text))}
                <p>body</p>
            </div>
        </>
    );
}

describe("an article's sections", () => {
    it("are listed in the order they stand, each linking to its heading", async () => {
        render(article([["h2", "Yeni harita"], ["h3", "Doğu adaları"], ["h2", "Ekonomi"]]));
        const links = await screen.findAllByRole("link");
        expect(links.map((a) => a.textContent)).toEqual(["Yeni harita", "Doğu adaları", "Ekonomi"]);
        expect(links.map((a) => a.getAttribute("href"))).toEqual(["#yeni-harita", "#dogu-adalari", "#ekonomi"]);
        expect(document.getElementById("dogu-adalari")?.textContent).toBe("Doğu adaları");
        expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe("contents");
    });

    it("keep an address a heading already had, and never give two the same", async () => {
        render(article([["h2", "Ekonomi"], ["h2", "Ekonomi"]]));
        const links = await screen.findAllByRole("link");
        expect(links.map((a) => a.getAttribute("href"))).toEqual(["#ekonomi", "#ekonomi-2"]);
    });

    it("are not listed when there is only one", () => {
        render(article([["h2", "Tek bölüm"]]));
        expect(screen.queryByRole("navigation")).toBeNull();
    });
});
