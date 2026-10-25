/**
 * A page drawn in the browser is arranged as a page drawn on the server is.
 *
 * Most module pages are client components: a ticket, the cart, the wheel read
 * what they show after they arrive, so the server-side `ArrangedPage` cannot
 * draw them. The browser holds the active theme's manifest, and
 * `ArrangedClientPage` resolves the page's arrangement from it with the same
 * resolver and draws it with the same rows: the theme's arrangement when
 * it has one, the page's own otherwise, and the title kept as the page's one
 * h1 when the theme hides the header.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LayoutDocument } from "@/core/lib/page-layout-schema";

vi.mock("@/core/generated/module-pages", async () => {
    const { pagesOf } = await import("@/core/lib/page-blocks");
    return {
        ModulePages: pagesOf("m", {
            pages: [{
                id: "ticket",
                blocks: [{ id: "thread", widths: ["wide", "full"] }, { id: "details", widths: ["narrow", "wide"] }],
                layout: { rows: [{ split: "2-1", cells: [[{ key: "thread", block: "m.thread" }], [{ key: "details", block: "m.details" }]] }] },
            }],
        } as Parameters<typeof pagesOf>[1]),
    };
});
vi.mock("@/core/components/layout/SiteShell", () => ({ SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/core/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header> }));
const theme = vi.hoisted(() => ({ layouts: {} as Record<string, unknown> }));
vi.mock("@/core/providers/theme-provider", () => ({ useTheme: () => ({ activeTheme: { layouts: theme.layouts } }) }));
vi.mock("@/core/components/ModuleErrorBoundary", () => ({
    ModuleErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { ArrangedClientPage } = await import("@/core/components/layout/ArrangedClientPage");

const BLOCKS = { thread: () => <p>thread</p>, details: () => <p>details</p> };

function draw(layouts: Record<string, LayoutDocument>) {
    theme.layouts = layouts;
    render(<ArrangedClientPage page="m.ticket" frame={{ title: "Where is my rank?" }} blocks={BLOCKS} />);
}

describe("a page drawn in the browser", () => {
    it("stands as its module arranged it when the theme says nothing", () => {
        draw({});
        expect(document.querySelector("[data-sidebar-main]")?.textContent).toBe("thread");
        expect(document.querySelector("[data-sidebar]")?.textContent).toBe("details");
        expect(document.querySelector("header h1")?.textContent).toBe("Where is my rank?");
    });

    it("stands as the active theme arranges it", () => {
        draw({
            "m.ticket": {
                header: "hidden",
                rows: [{ split: "1", cells: [[{ key: "details", block: "m.details" }, { key: "thread", block: "m.thread" }]] }],
            },
        });
        expect([...document.querySelectorAll("[data-block]")].map((b) => b.getAttribute("data-block"))).toEqual(["m.details", "m.thread"]);
        expect(document.querySelector("[data-sidebar]")).toBeNull();
        const titles = screen.getAllByRole("heading", { level: 1 });
        expect(titles).toHaveLength(1);
        expect(titles[0].className).toContain("sr-only");
    });

    it("stands as the page while it waits, with no empty rows under what it says", () => {
        theme.layouts = {};
        render(
            <ArrangedClientPage page="m.ticket" frame={{ title: "Where is my rank?" }} blocks={{}}>
                <p>loading</p>
            </ArrangedClientPage>,
        );
        expect(screen.getByText("loading")).toBeTruthy();
        expect(document.querySelector("[data-layout-row]")).toBeNull();
        expect(document.querySelector("[data-sidebar]")).toBeNull();
    });

    it("still names the page when nothing declares it", () => {
        theme.layouts = {};
        render(<ArrangedClientPage page="m.nope" frame={{ title: "Lost" }} blocks={BLOCKS} />);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Lost");
        expect(document.querySelector("[data-block]")).toBeNull();
    });
});
