/**
 * Quarry's page header takes what a page offers about itself: an article's
 * cover behind the band, and the line saying its section, date and author.
 *
 * The cover is decoration there, the article's own picture shown once more,
 * so it is hidden from a screen reader and carried as a background. Its
 * address is quoted into the style, so one with a bracket or a quote in it
 * cannot end the `url()` and say anything else. A page that offers neither
 * gets the band as every other page has it.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/core/sdk/theme", () => ({ PageBreadcrumb: ({ current }: { current: string }) => <nav>{current}</nav> }));

const { default: PageHeader } = await import("@/themes/quarry/components/PageHeader");

describe("the Quarry header stands on an article's cover", () => {
    it("draws the cover behind the band, unseen by a screen reader, and marks the band for it", () => {
        const { container } = render(<PageHeader title="Season four" picture={'/uploads/a cover")x.jpg'} />);

        const header = container.querySelector("header");
        const picture = container.querySelector(".qr-page-picture") as HTMLElement;
        expect(header?.hasAttribute("data-picture")).toBe(true);
        expect(picture.getAttribute("aria-hidden")).toBe("true");
        expect(picture.style.backgroundImage).toBe(`url(${JSON.stringify('/uploads/a cover")x.jpg')})`);
    });

    it("says what the page offers about itself beside its title", () => {
        render(<PageHeader title="Season four" meta={<span>News · 22 October</span>} />);
        expect(screen.getByText("News · 22 October").closest(".qr-page-meta")).not.toBeNull();
    });

    it("is the plain band for a page that offers neither", () => {
        const { container } = render(<PageHeader title="Store" />);
        expect(container.querySelector("header")?.hasAttribute("data-picture")).toBe(false);
        expect(container.querySelector(".qr-page-picture, .qr-page-meta")).toBeNull();
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Store");
    });
});
