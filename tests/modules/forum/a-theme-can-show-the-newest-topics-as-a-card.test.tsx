/**
 * A theme can show the forum's newest topics as a card of its own.
 *
 * `forum.latest-topics` is the latest-topics widget for a row of cards: each
 * topic carries its section's colour and name beside who started it and
 * when, and the card ends on a button into the forum. A colour is drawn only
 * when it is a colour; a section's colour is free text in the panel and is
 * otherwise left to the theme. A forum with nothing in it says so, because
 * a card that vanished would leave a hole in its row, and a read that did not
 * come back says that.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
    usePathname: () => "/",
    useRouter: () => ({ push: () => {} }),
}));

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/forum/module.json"), "utf8"));
const MESSAGES = {
    ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8")),
    ...MANIFEST.translations.en,
    sample: { title: "Fresh on the forum" },
};
const en = MANIFEST.translations.en.forum;

const answer = { topics: [] as unknown[], down: false, asked: [] as string[] };

beforeEach(() => {
    answer.topics = [];
    answer.down = false;
    answer.asked = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        answer.asked.push(url);
        return answer.down ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ topics: answer.topics }) };
    }));
});

const { LatestTopicsBlock } = await import("@/modules/forum/components/LatestTopicsBlock");

const topic = (n: number, color: string | null) => ({
    id: `t${n}`, number: n, slug: `topic-${n}`, title: `Topic ${n}`, createdAt: new Date().toISOString(),
    author: { username: `author${n}` }, category: { name: `Section ${n}`, color },
});

function draw(settings: Record<string, unknown> = {}) {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <LatestTopicsBlock settings={settings} width="narrow" />
        </NextIntlClientProvider>,
    );
}

describe("the latest topics card", () => {
    it("is declared as a block a theme places, beside the widget", () => {
        const block = MANIFEST.blocks.find((b: { id: string }) => b.id === "latest-topics");
        expect(block?.defaultVisible).toBe(false);
        expect(MANIFEST.widgets.find((w: { id: string }) => w.id === "LatestTopicsWidget")).toBeTruthy();
    });

    it("lists the newest topics with their section, under the theme's title, and ends on a way into the forum", async () => {
        answer.topics = [topic(1, "#4caf1f"), topic(2, "red; position: fixed")];
        draw({ title: "sample.title" });
        const first = (await screen.findByText("Topic 1")).closest("li") as HTMLElement;
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Fresh on the forum");
        expect(within(first).getByText(/Section 1/)).toBeTruthy();
        expect(within(first).getByText(/author1/)).toBeTruthy();
        expect((first.querySelector("[data-topic-colour]") as HTMLElement).style.backgroundColor).toBe("rgb(76, 175, 31)");
        const second = screen.getByText("Topic 2").closest("li") as HTMLElement;
        expect((second.querySelector("[data-topic-colour]") as HTMLElement).getAttribute("style")).toBeNull();
        expect(screen.getByRole("link", { name: en.widget_latestAll }).getAttribute("href")).toBe("/forum");
        expect(answer.asked[0]).toContain("order=newest");
    });

    it("says who and when, without an empty place for a section, of a topic in none", async () => {
        answer.topics = [{ ...topic(1, null), category: null }];
        draw();
        const meta = (await screen.findByText("Topic 1")).closest("li")!.querySelector("span.block.text-xs")!;
        expect(meta.textContent).not.toMatch(/·\s*·/);
        expect(meta.textContent).toContain("author1");
    });

    it("says the forum is empty rather than leaving a hole", async () => {
        draw();
        expect(await screen.findByText(en.noTopics)).toBeTruthy();
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(en.widget_latestTitle);
    });

    it("says a read that did not come back failed, and can ask again", async () => {
        answer.down = true;
        draw();
        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(screen.queryByText(en.noTopics)).toBeNull();
        answer.down = false;
        answer.topics = [topic(1, null)];
        fireEvent.click(screen.getByRole("button", { name: MESSAGES.common.retry }));
        expect(await screen.findByText("Topic 1")).toBeTruthy();
    });
});
