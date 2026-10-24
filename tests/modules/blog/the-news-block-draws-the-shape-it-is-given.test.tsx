/**
 * The news block draws the shape a theme gives it.
 *
 * `grid` is the homepage's news as it always was: a heading and pages of
 * cards. `featured` leads with the newest article drawn large, its picture,
 * date, reading time and summary, and lists the next three beside it. Either
 * way the heading is the block's heading, words a theme gave it are shown in
 * the reader's language, and with nothing published the heading stays above
 * the empty card, where every other state draws it.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/",
}));

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/blog/module.json"), "utf8"));
const MESSAGES = {
    ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8")),
    ...MANIFEST.translations.en,
    sample: { kicker: "Latest" },
};

const article = (n: number) => ({
    id: String(n),
    number: n,
    slug: `article-${n}`,
    title: `Headline ${n}`,
    excerpt: `Summary ${n}`,
    content: "word ".repeat(450),
    coverImage: null,
    publishedAt: "2026-10-24T10:00:00.000Z",
    createdAt: "2026-10-24T10:00:00.000Z",
    category: { name: `Category ${n}`, slug: `category-${n}` },
});

const { NewsBlock } = await import("@/modules/blog/components/NewsBlock");
const { default: LatestArticle } = await import("@/modules/blog/slots/LatestArticle");

function draw(settings: Record<string, unknown>, articles: unknown[]) {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ articles })));
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES} timeZone="UTC">
            <NewsBlock settings={{ variant: "grid", kicker: "", title: "", allLink: false, ...settings }} width="wide" />
        </NextIntlClientProvider>,
    );
}

afterEach(() => vi.unstubAllGlobals());

describe("the news block", () => {
    it("is declared in place of the homepage section it was", () => {
        const news = MANIFEST.blocks.find((b: { id: string }) => b.id === "news");
        expect(news.replaces).toEqual(["BlogNewsSection"]);
        expect(news.widths).toEqual(expect.arrayContaining(["wide", "full"]));
        expect(MANIFEST.homepageSections ?? []).toEqual([]);
    });

    it("leads with the newest article drawn large when featured", async () => {
        draw({ variant: "featured" }, [1, 2, 3, 4, 5].map(article));
        const lead = (await screen.findByRole("heading", { level: 3, name: "Headline 1" })).closest("article")!;
        expect(within(lead).getByText("Summary 1")).toBeTruthy();
        expect(within(lead).getByText(/2 min read/)).toBeTruthy();
        expect(within(lead).getByText(MESSAGES.news.readMore)).toBeTruthy();
        for (const n of [2, 3, 4]) expect(screen.getByRole("heading", { level: 3, name: `Headline ${n}` })).toBeTruthy();
        expect(screen.queryByText("Headline 5")).toBeNull();
    });

    // A news item is dated as an article is, with the month by name: "10/24/2026"
    // read as a form field, and in half the world as the wrong day.
    it("dates its articles with the month by name", async () => {
        draw({ variant: "featured" }, [1, 2].map(article));
        const lead = (await screen.findByRole("heading", { level: 3, name: "Headline 1" })).closest("article")!;
        const row = screen.getByRole("heading", { level: 3, name: "Headline 2" }).closest("article")!;
        expect(within(lead).getByText(/October 24, 2026/)).toBeTruthy();
        expect(within(row).getByText("October 24, 2026")).toBeTruthy();
    });

    it("says its heading in the reader's language and links to every article", async () => {
        draw({ variant: "featured", kicker: "sample.kicker", allLink: true }, [1].map(article));
        expect(await screen.findByText("Latest")).toBeTruthy();
        expect(screen.getByRole("heading", { level: 2, name: MESSAGES.news.title })).toBeTruthy();
        expect(screen.getByText(new RegExp(MESSAGES.blog.allArticles)).closest("a")?.getAttribute("href")).toBe("/blog");
    });

    it("draws pages of cards as a grid, as it always did", async () => {
        draw({}, [1, 2, 3, 4, 5].map(article));
        expect(await screen.findByText("Headline 1")).toBeTruthy();
        expect(screen.getByText("Headline 4")).toBeTruthy();
        expect(screen.queryByText("Headline 5")).toBeNull();
    });

    it("keeps its heading above the empty card", async () => {
        for (const variant of ["grid", "featured"]) {
            const { unmount } = draw({ variant }, []);
            const empty = await screen.findByText(MESSAGES.news.empty);
            const heading = screen.getByRole("heading", { level: 2, name: MESSAGES.news.title });
            const card = empty.closest(".border-dashed");
            expect(card, variant).not.toBeNull();
            expect(card!.contains(heading), variant).toBe(false);
            unmount();
        }
    });

    it("says a read that did not come back failed, not that there is no news", async () => {
        for (const variant of ["grid", "featured"]) {
            let down = true;
            vi.stubGlobal("fetch", async () => (down ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ articles: [article(1)] }))));
            const { unmount } = render(
                <NextIntlClientProvider locale="en" messages={MESSAGES} timeZone="UTC">
                    <NewsBlock settings={{ variant, kicker: "", title: "", allLink: false }} width="wide" />
                </NextIntlClientProvider>,
            );
            expect(await screen.findByRole("alert"), variant).toBeTruthy();
            expect(screen.queryByText(MESSAGES.news.empty), variant).toBeNull();
            down = false;
            fireEvent.click(screen.getByRole("button", { name: MESSAGES.common.retry }));
            expect(await screen.findByText("Headline 1"), variant).toBeTruthy();
            unmount();
        }
    });
});

// Someone signing back in is shown what they missed: the newest article,
// beside the form, in a theme's `auth.login.aside`.
describe("the newest article beside the sign-in form", () => {
    function aside(articles: unknown[], ok = true) {
        vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ articles }), { status: ok ? 200 : 503 }));
        return render(
            <NextIntlClientProvider locale="en" messages={MESSAGES} timeZone="UTC">
                <LatestArticle />
            </NextIntlClientProvider>,
        );
    }

    it("is offered to the sign-in screen's aside", () => {
        expect(MANIFEST.slotContents.find((s: { slot: string; id: string }) => s.slot === "auth.login.aside" && s.id === "latest-article")).toBeTruthy();
    });

    it("shows the newest article: its category, date, reading time, headline and summary, and links to it", async () => {
        aside([1, 2].map(article));
        const card = (await screen.findByRole("heading", { name: "Headline 1" })).closest("article")!;
        expect(within(card).getByText("Category 1")).toBeTruthy();
        expect(within(card).getByText(/October 24, 2026 · 2 min read/)).toBeTruthy();
        expect(within(card).getByText("Summary 1")).toBeTruthy();
        expect(within(card).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/blog/1/article-1", "/blog/1/article-1"]);
        expect(screen.queryByText("Headline 2")).toBeNull();
    });

    it("draws nothing when nothing is published or the read failed", async () => {
        const none = aside([]);
        await new Promise((r) => setTimeout(r, 20));
        expect(none.container.innerHTML).toBe("");
        none.unmount();
        const failed = aside([1].map(article), false);
        await new Promise((r) => setTimeout(r, 20));
        expect(failed.container.innerHTML).toBe("");
    });
});
