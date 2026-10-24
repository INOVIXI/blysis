/**
 * A resolved arrangement is drawn with the hooks themes already style.
 *
 * A two thirds and one third row is the page every site has today, and
 * themes and specs reach into it by `data-sidebar-layout`,
 * `data-sidebar-main`, `data-sidebar` and the heading spacer. So that row is
 * drawn through `StandardSidebarLayout` exactly as the homepage drew it, and
 * only the other splits are a grid of their own. Every block stands in a box
 * that names it, its variant and its width, and lays itself out by that box.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import type { ResolvedLayout, ResolvedInstance } from "@/core/lib/page-layout";
import type { CatalogBlock } from "@/core/lib/page-blocks";

vi.mock("@/core/generated/module-components", () => ({
    BlockComponentRegistry: {
        "m.wide": () => <p>wide block</p>,
        "m.side": () => <p>side block</p>,
        "m.empty": () => null,
    },
}));
vi.mock("@/core/components/ModuleErrorBoundary", () => ({
    ModuleErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { PageLayoutView } = await import("@/core/components/layout/PageLayoutView");

function placed(id: string, width: ResolvedInstance["width"], settings: Record<string, unknown> = {}): ResolvedInstance {
    const block = { id, module: "m", entryId: id.split(".")[1], component: "x", widths: [width], defaultOrder: 0, defaultVisible: true, settings: {}, replaces: [] } as CatalogBlock;
    return { key: id.replace(".", "-"), block, settings, width };
}

const WELCOME = <div>welcome card</div>;

describe("an arrangement on the page", () => {
    it("draws a two thirds and one third row as the sidebar layout", () => {
        const layout: ResolvedLayout = { welcome: false, rows: [{ split: "2-1", cells: [[placed("m.wide", "wide")], [placed("m.side", "narrow")]] }] };
        const { container } = render(<PageLayoutView layout={layout} welcome={WELCOME} />);
        const main = container.querySelector("[data-sidebar-layout] > [data-sidebar-main]");
        const side = container.querySelector("[data-sidebar-layout] > [data-sidebar]");
        expect(main?.querySelector('[data-block="m.wide"]')).not.toBeNull();
        expect(side?.firstElementChild?.classList.contains("blysis-heading-spacer")).toBe(true);
        expect(side?.querySelector('[data-block="m.side"]')).not.toBeNull();
    });

    it("draws the main column alone when nothing stands beside it", () => {
        const layout: ResolvedLayout = { welcome: false, rows: [{ split: "2-1", cells: [[placed("m.wide", "wide")], []] }] };
        const { container } = render(<PageLayoutView layout={layout} welcome={WELCOME} />);
        expect(container.querySelector("[data-sidebar-layout]")).toBeNull();
        expect(screen.getByText("wide block")).toBeTruthy();
    });

    it("draws a row of three as three cells", () => {
        const layout: ResolvedLayout = { welcome: false, rows: [{ split: "1-1-1", cells: [[placed("m.side", "narrow")], [], []] }] };
        const { container } = render(<PageLayoutView layout={layout} welcome={WELCOME} />);
        const row = container.querySelector('[data-layout-row="1-1-1"]');
        expect(row?.querySelectorAll(":scope > [data-layout-cell]")).toHaveLength(3);
    });

    it("names each block's variant and width, and lays it out by its box", () => {
        const layout: ResolvedLayout = { welcome: false, rows: [{ split: "1", cells: [[placed("m.wide", "wide", { variant: "featured" })]] }] };
        const { container } = render(<PageLayoutView layout={layout} welcome={WELCOME} />);
        const box = container.querySelector('[data-block="m.wide"]');
        expect(box?.getAttribute("data-variant")).toBe("featured");
        expect(box?.getAttribute("data-width")).toBe("wide");
        expect(box?.classList.contains("@container")).toBe(true);
    });

    it("draws the welcome card in the main column when there is no content", () => {
        const layout: ResolvedLayout = { welcome: true, rows: [{ split: "2-1", cells: [[], [placed("m.side", "narrow")]] }] };
        const { container } = render(<PageLayoutView layout={layout} welcome={WELCOME} />);
        expect(container.querySelector("[data-sidebar-main]")?.textContent).toContain("welcome card");
    });

    it("draws the welcome card above a page with no wide cell", () => {
        const layout: ResolvedLayout = { welcome: true, rows: [{ split: "1-1", cells: [[placed("m.side", "narrow")], []] }] };
        render(<PageLayoutView layout={layout} welcome={WELCOME} />);
        expect(screen.getByText("welcome card")).toBeTruthy();
    });
});

describe("a sidebar of blocks that drew nothing", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

    it("collapses, because an empty block box does not count as content", () => {
        expect(css).toMatch(/\[data-block\]:empty\s*\{\s*display:\s*none;?\s*\}/);
        expect(css).toContain("[data-sidebar-layout] > [data-sidebar]:not(:has(> :not(template, .blysis-heading-spacer, [data-block]:empty)))");
        expect(css).toContain("[data-sidebar-layout]:has(> [data-sidebar] > :not(template, .blysis-heading-spacer, [data-block]:empty)) > [data-sidebar-main]");
    });
});
