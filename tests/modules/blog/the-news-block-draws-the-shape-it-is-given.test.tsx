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
import { render, screen, within } from "@testing-library/react";
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
});
