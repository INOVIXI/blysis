/**
 * The servers can open the homepage as cards and as a count of players.
 *
 * `servers.cards` draws a card for every active server: its picture, how
 * many are playing, its name, the line the operator wrote about it and a
 * button that copies its address, which must work over plain http where the
 * clipboard API does not exist. The `home.stats` tile is everyone playing on
 * the servers that can be asked, and nothing at all when none can.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const copied = vi.hoisted(() => ({ values: [] as string[] }));
const answer = vi.hoisted(() => ({ servers: [] as unknown[], down: false }));

vi.mock("@/core/sdk", () => ({
    copyText: vi.fn(async (value: string) => { copied.values.push(value); return true; }),
    sharedJson: vi.fn(async () => {
        if (answer.down) throw new Error("status answered 503");
        return { servers: answer.servers };
    }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    usePathname: () => "/",
    useRouter: () => ({ push: () => {} }),
}));

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/servers/module.json"), "utf8"));
const MESSAGES = { ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8")), ...MANIFEST.translations.en };
const en = MANIFEST.translations.en.servers;

const server = (name: string, over: Record<string, unknown> = {}) => ({
    id: name, name, type: "minecraft", queryable: true, online: true, players: { online: 0, max: 100 },
    address: `${name.toLowerCase()}.example.com`, description: null, image: null, version: "", motd: "", ...over,
});

const { ServerCards } = await import("@/modules/servers/components/ServerCards");
const { default: PlayersTile } = await import("@/modules/servers/slots/PlayersTile");
const { default: StatusTag } = await import("@/modules/servers/slots/StatusTag");

function draw(node: React.ReactNode) {
    return render(<NextIntlClientProvider locale="en" messages={MESSAGES}>{node}</NextIntlClientProvider>);
}

beforeEach(() => {
    copied.values = [];
    answer.servers = [];
    answer.down = false;
});

describe("the server cards", () => {
    it("are declared as a block, with the count as a tile for the stats row", () => {
        expect(MANIFEST.blocks.find((b: { id: string }) => b.id === "cards")).toBeTruthy();
        expect(MANIFEST.slotContents.find((s: { slot: string }) => s.slot === "home.stats")).toBeTruthy();
    });

    it("draw each server with how many play, what it is, and a way in", async () => {
        answer.servers = [
            server("Survival", { players: { online: 128, max: 500 }, description: "One world, a real economy." }),
            server("Creative", { online: false }),
        ];
        draw(<ServerCards settings={{ kicker: "", title: "" }} width="full" />);
        expect(await screen.findByRole("heading", { level: 3, name: "Survival" })).toBeTruthy();
        expect(screen.getByText("One world, a real economy.")).toBeTruthy();
        expect(screen.getByText(en.cards_players.replace("{count}", "128"))).toBeTruthy();
        expect(screen.getByText(en.offline)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: en.widget_copy.replace("{name}", "Survival") }));
        await waitFor(() => expect(copied.values).toEqual(["survival.example.com"]));
    });

    it("say a read that did not come back failed, and can ask again", async () => {
        answer.down = true;
        draw(<ServerCards settings={{}} width="full" />);
        expect(await screen.findByRole("alert")).toBeTruthy();
        answer.down = false;
        answer.servers = [server("Survival")];
        fireEvent.click(screen.getByRole("button", { name: MESSAGES.common.retry }));
        expect(await screen.findByRole("heading", { level: 3, name: "Survival" })).toBeTruthy();
    });

    it("hold the room of a row of cards while the statuses are on their way", () => {
        answer.servers = [server("Survival")];
        const { container } = draw(<ServerCards settings={{}} width="full" />);
        // An outline of a card, drawn and hidden: its height is the real
        // card's under whatever theme and width, where a fixed number is not.
        const outline = container.querySelector('[aria-hidden="true"].invisible [data-server-card]');
        expect(outline).toBeTruthy();
        expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    });

    it("draw nothing on a site with no server", async () => {
        const { container } = draw(<ServerCards settings={{}} width="full" />);
        await waitFor(() => expect(container.innerHTML).toBe(""));
    });
});

describe("the players tile", () => {
    it("counts everyone playing on the servers that can be asked", async () => {
        answer.servers = [server("A", { players: { online: 100, max: 1 } }), server("B", { players: { online: 14, max: 1 } }), server("C", { online: false, players: { online: 9, max: 1 } })];
        draw(<PlayersTile />);
        expect(await screen.findByText("114")).toBeTruthy();
        expect(screen.getByText(en.tile_players)).toBeTruthy();
    });

    it("is not drawn when no server can be asked", async () => {
        answer.servers = [server("Hytale", { queryable: false })];
        const { container } = draw(<PlayersTile />);
        await waitFor(() => expect(container.innerHTML).toBe(""));
    });
});

describe("the status tag on the hero", () => {
    it("is offered to the hero's tags", () => {
        expect(MANIFEST.slotContents.find((s: { slot: string }) => s.slot === "hero.tags")).toBeTruthy();
    });

    it("says the server is open and how many play", async () => {
        answer.servers = [server("A", { players: { online: 200, max: 1 } }), server("B", { players: { online: 14, max: 1 } })];
        draw(<StatusTag />);
        const tag = await screen.findByText(en.tag_open.replace("{count}", "214"));
        expect(tag.closest("[data-hero-tag]")?.getAttribute("data-state")).toBe("open");
    });

    it("says it is closed when no server that can be asked answers", async () => {
        answer.servers = [server("A", { online: false })];
        draw(<StatusTag />);
        const tag = await screen.findByText(en.tag_closed);
        expect(tag.closest("[data-hero-tag]")?.getAttribute("data-state")).toBe("closed");
    });

    it("says nothing about a game it cannot ask", async () => {
        answer.servers = [server("Hytale", { queryable: false })];
        const { container } = draw(<StatusTag />);
        await waitFor(() => expect(container.innerHTML).toBe(""));
    });
});
