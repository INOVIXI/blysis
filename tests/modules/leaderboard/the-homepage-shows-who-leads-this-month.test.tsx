/**
 * The homepage can show who leads the site's boards over the last month.
 *
 * The leaderboard had a page and nothing else, so the ranking a game-server
 * community keeps to be seen on - who votes for the server, who buys, who
 * posts - lived one click away from everyone. The widget shows the top few of
 * whatever boards the installed modules offer, over the last thirty days, and
 * names none of them itself: a board arrives with the module that owns it.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
    usePathname: () => "/",
    useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/core/components/currency/site-currency", () => ({
    useSiteCurrency: () => ({ format: (n: number) => `₺${n.toFixed(2)}` }),
}));

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/leaderboard/module.json"), "utf8"));
const { LeaderboardWidget } = await import("@/modules/leaderboard/widgets/leaderboard-widget");

const BOARDS = [
    { id: "voters", labelKey: "vote.leaderboardVoters", icon: "Medal", unit: "count", rows: [] },
    { id: "buyers", labelKey: "store.leaderboardBuyers", icon: "Crown", unit: "currency", rows: [] },
];
const ROWS: Record<string, unknown[]> = {
    voters: [
        { username: "ada", avatar: null, value: 31, rank: 1 },
        { username: "grace", avatar: null, value: 17, rank: 2 },
    ],
    buyers: [{ username: "linus", avatar: null, value: 120, rank: 1 }],
};

function serve(boards: unknown[]) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        const board = new URL(String(url), "https://example.com").searchParams.get("board");
        const found = board ? [{ ...(boards as { id: string }[]).find((b) => b.id === board), rows: ROWS[board] ?? [] }] : boards;
        return { ok: true, json: async () => ({ boards: found }) };
    }));
}

function draw(locale = "en") {
    const messages = {
        ...MANIFEST.translations[locale],
        vote: { leaderboardVoters: "Voters" },
        store: { leaderboardBuyers: "Buyers" },
    };
    return render(
        <NextIntlClientProvider locale={locale} messages={messages}>
            <LeaderboardWidget />
        </NextIntlClientProvider>,
    );
}

describe("the leaderboard widget", () => {
    it("asks the first board for its top five over the last thirty days", async () => {
        serve(BOARDS);
        draw();
        expect(await screen.findByText("ada")).toBeTruthy();
        const asked = vi.mocked(fetch).mock.calls.map((c) => String(c[0])).find((u) => u.includes("board="))!;
        const params = new URL(asked, "https://example.com").searchParams;
        expect(params.get("board")).toBe("voters");
        expect(params.get("limit")).toBe("5");
        expect(params.get("period")).toBe("month");
        expect(screen.getByText("31")).toBeTruthy();
    });

    it("moves to another board, and shows money as money", async () => {
        serve(BOARDS);
        draw();
        await screen.findByText("ada");
        fireEvent.click(screen.getByRole("tab", { name: /Buyers/ }));
        expect(await screen.findByText("linus")).toBeTruthy();
        expect(screen.getByText("₺120.00")).toBeTruthy();
    });

    it("offers no tabs when there is one board to show", async () => {
        serve(BOARDS.slice(0, 1));
        draw();
        await screen.findByText("ada");
        expect(screen.queryByRole("tablist")).toBeNull();
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Voters");
    });

    it("draws nothing when no module offers a board", async () => {
        serve([]);
        const { container } = draw();
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(container.innerHTML).toBe("");
    });

    it("does not call a board it could not read an empty one", async () => {
        // "Nobody yet" is a claim about the site; a refused read is not.
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (String(url).includes("board=")) return { ok: false, json: async () => ({}) };
            return { ok: true, json: async () => ({ boards: BOARDS }) };
        }));
        const { container } = draw();
        await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1));
        await waitFor(() => expect(container.innerHTML).toBe(""));
        expect(screen.queryByText(MANIFEST.translations.en.leaderboard.widget_empty)).toBeNull();
    });

    it("links to the whole leaderboard", async () => {
        serve(BOARDS);
        draw();
        await screen.findByText("ada");
        expect(screen.getByRole("link", { name: MANIFEST.translations.en.leaderboard.widget_all }).getAttribute("href")).toBe("/leaderboard");
    });

    it("speaks every language the module does", () => {
        for (const [locale, catalogue] of Object.entries(MANIFEST.translations as Record<string, { leaderboard: Record<string, string>; admin: Record<string, string> }>)) {
            for (const key of ["widget_title", "widget_all", "widget_empty"]) {
                expect(catalogue.leaderboard[key], `${locale} leaderboard.${key}`).toBeTruthy();
            }
            expect(catalogue.admin.widget_leaderboard, `${locale} admin.widget_leaderboard`).toBeTruthy();
        }
    });
});
