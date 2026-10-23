/**
 * The homepage can say where the game is played and whether it is up.
 *
 * The servers module asked every game server for its status and published
 * it on a public endpoint that nothing on a public page read, so the one
 * thing a visitor to a game server's site most wants - the address to type
 * into the game - had to be written into a page by hand. The widget lists
 * each active server with how many are playing and a button that copies its
 * address, which has to work on a site still served over plain http, where
 * the clipboard API does not exist.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const copied = vi.hoisted(() => ({ values: [] as string[], works: true }));

vi.mock("@/core/sdk", () => ({
    copyText: vi.fn(async (value: string) => {
        copied.values.push(value);
        return copied.works;
    }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// next-intl's client navigation cannot be resolved under jsdom, and the
// widget links nowhere; the UI barrel pulls it in for other primitives.
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    usePathname: () => "/",
    useRouter: () => ({ push: () => {} }),
}));

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/servers/module.json"), "utf8"));
const { ServerStatusWidget } = await import("@/modules/servers/widgets/server-status-widget");
const { toast } = await import("sonner");

const servers = { current: [] as unknown[] };

beforeEach(() => {
    copied.values = [];
    copied.works = true;
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ servers: servers.current }) })));
});

function draw(locale = "en") {
    return render(
        <NextIntlClientProvider locale={locale} messages={MANIFEST.translations[locale]}>
            <ServerStatusWidget />
        </NextIntlClientProvider>,
    );
}

const en = MANIFEST.translations.en.servers;

describe("the server status widget", () => {
    it("names each server with its address and how many are playing", async () => {
        servers.current = [
            { id: "a", name: "Survival", type: "minecraft", queryable: true, online: true, players: { online: 12, max: 100 }, address: "play.example.com" },
            { id: "b", name: "Creative", type: "minecraft", queryable: true, online: false, players: { online: 0, max: 0 }, address: "play.example.com:25566" },
        ];
        draw();
        expect(await screen.findByText("Survival")).toBeTruthy();
        expect(screen.getByText("play.example.com")).toBeTruthy();
        expect(screen.getByText(en.widget_playing.replace("{online}", "12").replace("{max}", "100"))).toBeTruthy();
        expect(screen.getByText(en.offline)).toBeTruthy();
    });

    it("copies the address a player types, and says so", async () => {
        servers.current = [{ id: "a", name: "Survival", type: "minecraft", queryable: true, online: true, players: { online: 1, max: 10 }, address: "play.example.com" }];
        draw();
        fireEvent.click(await screen.findByRole("button", { name: en.widget_copy.replace("{name}", "Survival") }));
        await waitFor(() => expect(copied.values).toEqual(["play.example.com"]));
        expect(toast.success).toHaveBeenCalledWith(en.widget_copied);
    });

    it("says so when the copy did not happen, rather than claiming it did", async () => {
        copied.works = false;
        servers.current = [{ id: "a", name: "Survival", type: "minecraft", queryable: true, online: true, players: { online: 1, max: 10 }, address: "play.example.com" }];
        draw();
        fireEvent.click(await screen.findByRole("button", { name: en.widget_copy.replace("{name}", "Survival") }));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.widget_copyFailed));
        expect(toast.success).not.toHaveBeenCalled();
    });

    it("gives no player count for a game it cannot ask", async () => {
        servers.current = [{ id: "h", name: "Hytale", type: "hytale", queryable: false, online: false, players: { online: 0, max: 0 }, address: "203.0.113.7:5520" }];
        draw();
        expect(await screen.findByText("203.0.113.7:5520")).toBeTruthy();
        expect(screen.queryByText(en.offline)).toBeNull();
    });

    it("offers no address for a server the endpoint would not publish one for", async () => {
        servers.current = [{ id: "b", name: "Backend", type: "minecraft", queryable: true, online: true, players: { online: 3, max: 50 }, address: null }];
        draw();
        expect(await screen.findByText("Backend")).toBeTruthy();
        expect(screen.queryByRole("button")).toBeNull();
    });

    it("draws nothing on a site with no server", async () => {
        servers.current = [];
        const { container } = draw();
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(container.innerHTML).toBe("");
    });

    it("speaks every language the module does", () => {
        for (const [locale, catalogue] of Object.entries(MANIFEST.translations as Record<string, { servers: Record<string, string>; admin: Record<string, string> }>)) {
            for (const key of ["widget_title", "widget_playing", "widget_copy", "widget_copied", "widget_copyFailed"]) {
                expect(catalogue.servers[key], `${locale} servers.${key}`).toBeTruthy();
            }
            expect(catalogue.admin.widget_serverStatus, `${locale} admin.widget_serverStatus`).toBeTruthy();
        }
    });
});
