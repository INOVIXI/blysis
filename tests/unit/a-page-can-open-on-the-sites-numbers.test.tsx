// @vitest-environment jsdom
/**
 * A page can open on a row of the site's numbers.
 *
 * `core.stats` draws the tiles modules give the `home.stats` slot, a live
 * count of players for example, then up to three the theme's layout gives
 * it, usually left to the operator through the theme's settings. A tile with
 * no value is not drawn, and a row with nothing in it is not drawn at all.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const slot = vi.hoisted(() => ({ filled: false }));

vi.mock("@/core/components/Slot", () => ({
    Slot: ({ name }: { name: string }) => (slot.filled ? <div data-testid="from-module">{name}</div> : null),
    useSlotHasContent: () => slot.filled,
}));
vi.mock("@/core/components/ui/NavIcon", () => ({ NavIcon: ({ name }: { name?: string }) => <i data-icon={name} /> }));

const MESSAGES = {
    ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8")),
    sample: { eventLabel: "building contest" },
};

const { CORE_BLOCKS } = await import("@/core/lib/core-blocks");
const { CORE_BLOCK_COMPONENTS } = await import("@/core/components/blocks");

function draw(settings: Record<string, unknown>) {
    const Stats = CORE_BLOCK_COMPONENTS["core.stats"];
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <Stats settings={settings} width="full" />
        </NextIntlClientProvider>,
    );
}

describe("the stats row", () => {
    it("is a core block a theme places, never one the page adds by itself", () => {
        const stats = CORE_BLOCKS.find((b) => b.id === "core.stats");
        expect(stats?.defaultVisible).toBe(false);
        expect(stats?.widths).toContain("full");
    });

    it("draws the tiles it was given, in the reader's language", () => {
        draw({ tile1Value: "Sat 20:00", tile1Label: "sample.eventLabel", tile1Icon: "Trophy", tile2Value: "", tile2Label: "ignored" });
        expect(screen.getByText("Sat 20:00")).toBeTruthy();
        expect(screen.getByText("building contest")).toBeTruthy();
        expect(screen.queryByText("ignored")).toBeNull();
    });

    it("draws what modules give it first", () => {
        slot.filled = true;
        const { container } = draw({ tile1Value: "12", tile1Label: "days" });
        const tiles = container.querySelectorAll("[data-stats] > *");
        expect(tiles[0].getAttribute("data-testid")).toBe("from-module");
        slot.filled = false;
    });

    it("draws nothing when it has nothing", () => {
        const { container } = draw({});
        expect(container.innerHTML).toBe("");
    });
});
