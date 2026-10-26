// @vitest-environment jsdom
/**
 * A plan can be bought from the top of its own column.
 *
 * A comparison runs to a dozen rows, and the only way to buy was a button
 * under the last of them: a reader who had already chosen scrolled past every
 * row to reach it. The column's header carries the same way in now, beside
 * the price it buys, and the footer keeps its own for the reader who read to
 * the end. Each says which plan it buys, since a row of links all called
 * "Buy" tells a screen reader nothing; the chosen column says it is the
 * chosen one, for a theme to set apart.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ children, href, ...rest }: { children?: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock("@/core/sdk/ui", () => ({
    Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    buttonClassName: () => "blysis-button",
    useSiteCurrency: () => ({ code: "USD", format: (n: number) => `$${n}` }),
}));

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/comparison-table/module.json"), "utf8"));
const MESSAGES = MANIFEST.translations.en;
const say = MESSAGES.comparisonTable;

const { ComparisonGrid } = await import("@/modules/comparison-table/components/ComparisonGrid");

const column = (id: string, over: Record<string, unknown> = {}) => ({
    id, label: id.toUpperCase(), subtitle: null, href: `/store/product/${id}`, highlight: false, image: null,
    price: 10, was: null, fullPrice: null, note: null, buyHref: `/store/cart?add=${id}`, ...over,
});

function draw() {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <ComparisonGrid table={{
                title: "Ranks",
                description: null,
                columns: [column("vip"), column("mvp", { highlight: true }), column("guide", { price: null, buyHref: null, href: "/guide" })],
                groups: [{ id: null, label: null, rows: [{ id: "fly", label: "Fly", cells: [] }] }],
            }} />
        </NextIntlClientProvider>,
    );
}

describe("a comparison's columns", () => {
    it("each offer their way in at the top, naming the plan", () => {
        const { container } = draw();
        const head = container.querySelector("thead") as HTMLElement;
        const links = within(head).getAllByRole("link").filter((a) => a.hasAttribute("data-column-buy"));
        expect(links.map((a) => [a.getAttribute("aria-label"), a.getAttribute("href")])).toEqual([
            [say.buyNamed.replace("{name}", "VIP"), "/store/cart?add=vip"],
            [say.buyNamed.replace("{name}", "MVP"), "/store/cart?add=mvp"],
            [say.chooseNamed.replace("{name}", "GUIDE"), "/guide"],
        ]);
    });

    it("keep the footer's way in, which names the plan too", () => {
        const { container } = draw();
        const foot = container.querySelector("tfoot") as HTMLElement;
        expect(within(foot).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual([
            say.buyNamed.replace("{name}", "VIP"),
            say.buyNamed.replace("{name}", "MVP"),
            say.chooseNamed.replace("{name}", "GUIDE"),
        ]);
        expect(screen.getAllByText(say.buy)).toHaveLength(4);
    });

    it("mark the chosen one for a theme to set apart", () => {
        const { container } = draw();
        const marked = Array.from(container.querySelectorAll("thead th[data-column-highlight]"));
        expect(marked.map((th) => th.textContent?.includes("MVP"))).toEqual([true]);
    });
});
