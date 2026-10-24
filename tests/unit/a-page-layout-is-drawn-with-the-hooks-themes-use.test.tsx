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
import { stripComments } from "./source-text";

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
        expect(css).toContain(":where([data-sidebar-layout]:has(> [data-sidebar] > :not(template, .blysis-heading-spacer, [data-block]:empty))) > [data-sidebar-main]");
    });
});

describe("a row of blocks that drew nothing", () => {
    /**
     * A row whose every block drew nothing is hidden, and the space between
     * rows is counted only between rows that drew: an empty row kept its 2rem
     * above it, so a site with no server left a gap where the server cards
     * would have stood. The stats row counts as empty when the tiles modules
     * gave it all drew nothing, which is a section with no child.
     */
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const selectorOf = (marker: string) => {
        const rule = stripComments(css).split("}").find((r) => r.includes(marker) && r.includes("display: none"));
        expect(rule, marker).toBeTruthy();
        return (rule as string).split("{")[0].trim();
    };
    const Empty = () => null;
    const Stats = () => <section data-stats />;
    const Drew = () => <p>drew</p>;
    const shape = (cells: React.ComponentType[][]) => (
        <div>
            {cells.map((cell, r) => (
                <div key={r} data-layout-row="1">
                    <div data-layout-cell>
                        <div data-layout-blocks>
                            {cell.map((C, b) => <div key={b} data-block={`m.b${b}`}><C /></div>)}
                        </div>
                    </div>
                </div>
            ))}
            <div data-layout-row="1"><div data-layout-cell><p>welcome card</p></div></div>
        </div>
    );

    it("is hidden, while a row with a block that drew or the welcome card is not", () => {
        const { container } = render(shape([[Empty], [Empty, Stats], [Empty, Drew]]));
        const hidden = [...container.querySelectorAll(selectorOf("[data-layout-row]:not("))];
        const rows = [...container.querySelectorAll("[data-layout-row]")];
        expect(hidden).toEqual([rows[0], rows[1]]);
    });

    it("leaves a stats row with nothing in it out of its cell", () => {
        const { container } = render(shape([[Stats, Drew]]));
        expect([...container.querySelectorAll(selectorOf("[data-stats]:empty)"))]).toEqual([container.querySelector('[data-block="m.b0"]')]);
    });

    it("is drawn by the page with its blocks in a box the rule can find", () => {
        const layout: ResolvedLayout = { welcome: false, rows: [{ split: "1", cells: [[placed("m.wide", "wide")]] }] };
        const { container } = render(<PageLayoutView layout={layout} welcome={WELCOME} />);
        expect(container.querySelector("[data-layout-row] > [data-layout-cell] > [data-layout-blocks] > [data-block]")).toBeTruthy();
    });

    it("takes no space above the next row", () => {
        expect(css).not.toMatch(/\[data-layout-row\]\)\s*\+/);
        // The space is a theme's to change, through a variable, so a theme
        // that wants more room keeps the rule that skips hidden rows.
        expect(css).toMatch(/\)\s*\{\s*margin-top: var\(--blysis-row-gap, 2rem\);/);
        expect(css).toMatch(/\)\s*~\s*:where\(\[data-sidebar-layout\], \[data-layout-row\]:has\(/);
    });
});

describe("a theme rule on a widget in the sidebar", () => {
    /**
     * Themes styled a sidebar widget as `[data-sidebar] > .bg-card`. On the
     * homepage every widget now stands in its block's box, one level down, so
     * such a rule reached the widget on every page but the one it was most
     * often looked at on.
     */
    it("reaches the widget inside its block's box too", () => {
        const themes = path.resolve(process.cwd(), "src/themes");
        const missing: string[] = [];
        let seen = 0;
        for (const id of fs.readdirSync(themes)) {
            const file = path.join(themes, id, "theme.css");
            if (!fs.existsSync(file)) continue;
            const css = fs.readFileSync(file, "utf8");
            for (const m of css.matchAll(/([^{}]*?)\[data-sidebar\] > (\.[\w-]+)/g)) {
                if (m[2] === ".blysis-heading-spacer") continue;
                seen++;
                const reach = `${m[1].trim().split(",").pop()?.trim() ?? ""} [data-sidebar] > [data-block] > ${m[2]}`.trim();
                if (!css.includes(reach)) missing.push(`${id}: ${reach}`);
            }
        }
        expect(seen).toBeGreaterThan(0);
        expect(missing).toEqual([]);
    });
});
