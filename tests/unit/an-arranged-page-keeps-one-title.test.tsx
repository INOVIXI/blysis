/**
 * A module's page is drawn as its arrangement says, and never loses its name.
 *
 * `ArrangedPage` draws only the blocks the arrangement placed, each in the
 * box themes style by attribute, and the row the page always had as its
 * sidebar through the same layout `PageFrame` used. A theme may hide the
 * header band: the title is then still the page's one h1, read and not seen.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ResolvedInstance, ResolvedPageLayout } from "@/core/lib/page-layout";
import type { CatalogBlock } from "@/core/lib/page-blocks";

const loadPageLayout = vi.fn<(page: string) => Promise<ResolvedPageLayout | null>>();
const logError = vi.fn();

vi.mock("@/core/lib/page-layout-loader", () => ({ loadPageLayout: (page: string) => loadPageLayout(page) }));
vi.mock("@/core/lib/logger", () => ({ log: { error: (...args: unknown[]) => logError(...args), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/core/components/layout/SiteShell", () => ({ SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/core/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header> }));
vi.mock("@/core/components/ModuleErrorBoundary", () => ({
    ModuleErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { ArrangedPage } = await import("@/core/components/layout/ArrangedPage");

function placed(entryId: string, width: ResolvedInstance["width"], settings: Record<string, unknown> = {}): ResolvedInstance {
    const block = { id: `m.${entryId}`, module: "m", entryId, component: "", widths: [width], defaultOrder: 0, defaultVisible: true, settings: {}, replaces: [] } as CatalogBlock;
    return { key: entryId, block, settings, width };
}

const BLOCKS = {
    article: ({ settings }: { settings: Record<string, unknown> }) => <p>article{settings.cover === false ? " without cover" : ""}</p>,
    related: () => <p>related</p>,
    share: () => <p>share</p>,
};

async function draw(page = "m.post") {
    render(await ArrangedPage({ page, frame: { title: "Season four" }, blocks: BLOCKS }));
}

beforeEach(() => {
    loadPageLayout.mockReset();
    logError.mockReset();
});

describe("an arranged page", () => {
    it("draws the blocks its arrangement placed, in the boxes themes style", async () => {
        loadPageLayout.mockResolvedValue({
            header: "shown",
            rows: [{ split: "1-2-1", cells: [[placed("related", "narrow")], [placed("article", "wide", { cover: false })], []] }],
        });
        await draw();
        expect(screen.getByText("article without cover").closest("[data-block]")?.getAttribute("data-block")).toBe("m.article");
        expect(screen.getByText("article without cover").closest("[data-block]")?.getAttribute("data-width")).toBe("wide");
        expect(screen.getByText("related")).toBeTruthy();
        expect(screen.queryByText("share")).toBeNull();
        expect(document.querySelector("[data-layout-row='1-2-1']")).not.toBeNull();
    });

    it("draws the page's sidebar row through the layout the frame always used", async () => {
        loadPageLayout.mockResolvedValue({
            header: "shown",
            rows: [{ split: "2-1", cells: [[placed("article", "wide")], [placed("related", "narrow"), placed("share", "narrow")]] }],
        });
        await draw();
        const side = document.querySelector("[data-sidebar-layout] > [data-sidebar]");
        expect(side?.textContent).toBe("relatedshare");
        expect(document.querySelector("[data-sidebar-main]")?.textContent).toBe("article");
    });

    it("draws two thirds and a third as the page's own columns when it has no sidebar", async () => {
        loadPageLayout.mockResolvedValue({
            header: "shown",
            rows: [{ split: "2-1", cells: [[placed("article", "wide")], [placed("related", "narrow")]] }],
        });
        render(await ArrangedPage({ page: "m.post", frame: { title: "Season four" }, blocks: BLOCKS, sidebar: false }));

        expect(document.querySelector("[data-sidebar-layout], [data-sidebar]")).toBeNull();
        const row = document.querySelector("[data-layout-row='2-1']");
        expect([...(row?.children ?? [])].map((cell) => cell.textContent)).toEqual(["article", "related"]);
        // Alone in its column, a block fills it, so what sticks in it has room to.
        expect(screen.getByText("related").closest("[data-layout-blocks]")?.className).toContain("[&>[data-block]:only-child]:flex-1");
    });

    it("holds its rows together, so they stand as a page's parts do and not as the homepage's", async () => {
        loadPageLayout.mockResolvedValue({
            header: "shown",
            rows: [
                { split: "1", cells: [[placed("article", "wide")]] },
                { split: "2-1", cells: [[placed("related", "wide")], [placed("share", "narrow")]] },
            ],
        });
        await draw();
        const rows = document.querySelector("[data-page-rows]");
        expect([...(rows?.children ?? [])].map((row) => row.getAttribute("data-layout-row") ?? row.hasAttribute("data-sidebar-layout"))).toEqual(["1", true]);
    });

    it("lets a block alone in a cell fill it, so cards side by side end level", async () => {
        loadPageLayout.mockResolvedValue({
            header: "shown",
            rows: [{ split: "1-1", cells: [[placed("article", "wide")], [placed("related", "wide"), placed("share", "wide")]] }],
        });
        await draw();
        const [alone, together] = [...document.querySelectorAll("[data-layout-cell] > [data-layout-blocks]")];
        expect(alone.className).toContain("h-full");
        expect(alone.className).toContain("[&>[data-block]:only-child]:flex-1");
        expect(together.children).toHaveLength(2);
    });

    it("sets two halves side by side from a tablet up, as the pages it replaced did", async () => {
        loadPageLayout.mockResolvedValue({
            header: "shown",
            rows: [{ split: "1-1", cells: [[placed("article", "wide")], [placed("related", "wide")]] }],
        });
        await draw();
        expect(document.querySelector("[data-layout-row='1-1']")?.className).toContain("md:grid-cols-2");
    });

    it("keeps its title as its one h1 when the theme hides the header", async () => {
        loadPageLayout.mockResolvedValue({ header: "hidden", rows: [{ split: "1", cells: [[placed("article", "wide")]] }] });
        await draw();
        const titles = screen.getAllByRole("heading", { level: 1 });
        expect(titles).toHaveLength(1);
        expect(titles[0].textContent).toBe("Season four");
        expect(titles[0].className).toContain("sr-only");
        expect(document.querySelector("header")).toBeNull();
    });

    it("draws the header band otherwise", async () => {
        loadPageLayout.mockResolvedValue({ header: "shown", rows: [] });
        await draw();
        expect(document.querySelector("header h1")?.textContent).toBe("Season four");
    });

    it("says so, and still names the page, when no module declares it", async () => {
        loadPageLayout.mockResolvedValue(null);
        await draw("m.nope");
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Season four");
        expect(screen.queryByText("article")).toBeNull();
        expect(logError).toHaveBeenCalledWith(expect.stringContaining("m.nope"));
    });
});
