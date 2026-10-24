/**
 * Who on the team is online can be a card of its own on the homepage.
 *
 * The strip under the hero says it in a line. `staff.online` says it as a
 * list a theme places beside the leaderboard: each member's picture or
 * initial, name and role, under the title the theme gave it. A card in a row
 * of three that vanished when nobody was on would leave a hole in the row,
 * so it says nobody is on instead, and a read that did not come back says
 * that rather than claiming an empty team.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    usePathname: () => "/",
    useRouter: () => ({ push: () => {} }),
}));

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/staff/module.json"), "utf8"));
const MESSAGES = {
    ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8")),
    ...MANIFEST.translations.en,
    sample: { title: "In game now" },
};
const en = MANIFEST.translations.en.staff;

const answer = { members: [] as unknown[], down: false };

beforeEach(() => {
    answer.members = [];
    answer.down = false;
    vi.stubGlobal("fetch", vi.fn(async () => (answer.down
        ? { ok: false, json: async () => ({}) }
        : { ok: true, json: async () => ({ members: answer.members }) })));
});

const { OnlineCard } = await import("@/modules/staff/components/OnlineCard");

function draw(settings: Record<string, unknown> = {}) {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <OnlineCard settings={settings} width="narrow" />
        </NextIntlClientProvider>,
    );
}

describe("the team online card", () => {
    it("is declared as a block a theme places", () => {
        const block = MANIFEST.blocks.find((b: { id: string }) => b.id === "online");
        expect(block?.defaultVisible).toBe(false);
        expect(block?.widths).toContain("narrow");
    });

    it("lists each member online with their initial or picture, name and role", async () => {
        answer.members = [
            { id: "m1", name: "Ada", role: "Admin", avatar: null, user: { username: "ada", avatar: "/a.png" } },
            { id: "m2", name: "Grace", role: "Moderator", avatar: null, user: null },
        ];
        draw({ title: "sample.title" });
        const list = await screen.findByRole("list");
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("In game now");
        expect(list.textContent).toContain("ada");
        expect(list.textContent).toContain("Admin");
        expect(list.textContent).toContain("Moderator");
        expect(list.querySelector("img")?.getAttribute("src")).toBe("/a.png");
        expect(list.textContent).toContain("G");
    });

    it("says nobody is online rather than leaving a hole", async () => {
        draw();
        expect(await screen.findByText(en.blk_nobodyOnline)).toBeTruthy();
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(en.onlineNow);
    });

    it("says a read that did not come back failed, and can ask again", async () => {
        answer.down = true;
        draw();
        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(screen.queryByText(en.blk_nobodyOnline)).toBeNull();
        answer.down = false;
        answer.members = [{ id: "m1", name: "Ada", role: "Admin", avatar: null, user: null }];
        fireEvent.click(screen.getByRole("button", { name: MESSAGES.common.retry }));
        expect(await screen.findByText("Ada")).toBeTruthy();
    });
});
