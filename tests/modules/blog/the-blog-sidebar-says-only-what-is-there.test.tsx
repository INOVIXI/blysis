/**
 * The blog's sidebar shows what a visitor can open, and nothing when there is nothing.
 *
 * On a blog with no categories the sidebar still drew a "Categories" card with
 * a heading and an empty list under it, and on a blog with nothing published a
 * "Recent posts" card the same way: on a phone, where the sidebar falls below
 * the articles, two empty boxes at the foot of the page.
 *
 * The number beside each category counted every article filed in it, drafts
 * and scheduled ones included, so a category reading "3" opened onto one
 * article. It counts what the listing itself would show.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/blog/module.json"), "utf8"))
    .translations.en;

vi.mock("next-intl/server", () => ({
    getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages: MESSAGES, namespace }),
    getLocale: async () => "en",
}));

vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock("@/core/sdk/layout", () => ({
    PageFrame: ({ title, sidebar, children }: { title: string; sidebar?: React.ReactNode; children: React.ReactNode }) => (
        <main>
            <h1>{title}</h1>
            {children}
            {sidebar ? <div data-testid="sidebar">{sidebar}</div> : null}
        </main>
    ),
}));

vi.mock("@/core/sdk/ui", () => ({ Pagination: () => null }));
vi.mock("@/modules/blog/components/news-grid", () => ({ NewsGrid: () => null }));

interface Category { id: string; name: string; slug: string; _count: { articles: number } }

const state: { categories: Category[]; categoryQuery: unknown; recent: unknown[] } = {
    categories: [],
    categoryQuery: null,
    recent: [],
};

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        blogArticle: {
            findMany: async (args: { take?: number }) => (args.take === 5 ? state.recent : []),
            count: async () => 0,
        },
        blogCategory: {
            findMany: async (args: unknown) => {
                state.categoryQuery = args;
                return state.categories;
            },
            findUnique: async () => null,
        },
        blogTag: { findUnique: async () => null },
    },
}));

const BlogPage = (await import("@/modules/blog/pages/page")).default;

beforeEach(() => {
    state.categories = [];
    state.categoryQuery = null;
    state.recent = [];
});

describe("the blog sidebar says only what is there", () => {
    it("draws no sidebar for a blog with no categories and nothing published", async () => {
        render(await BlogPage({}));

        expect(screen.queryByText(MESSAGES.blog.categories)).toBeNull();
        expect(screen.queryByText(MESSAGES.blog.recentPosts)).toBeNull();
        expect(screen.queryByTestId("sidebar")).toBeNull();
    });

    it("draws the recent posts without an empty categories card", async () => {
        state.recent = [{ id: "a1", number: 1, slug: "one", title: "The first one", publishedAt: new Date(), createdAt: new Date() }];
        render(await BlogPage({}));

        expect(screen.getByText(MESSAGES.blog.recentPosts)).toBeTruthy();
        expect(screen.queryByText(MESSAGES.blog.categories)).toBeNull();
    });

    it("counts only the articles a visitor can open in each category", async () => {
        state.categories = [{ id: "c1", name: "News", slug: "news", _count: { articles: 1 } }];
        render(await BlogPage({}));

        expect(screen.getByText(MESSAGES.blog.categories)).toBeTruthy();
        const counted = (state.categoryQuery as { include: { _count: { select: { articles: unknown } } } })
            .include._count.select.articles;
        expect(counted).toMatchObject({ where: { status: "PUBLISHED" } });
    });
});
