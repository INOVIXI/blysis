/**
 * The news section is a heading and then its cards, even with no news.
 *
 * The homepage lines its widget column up with the content column by drawing
 * a spacer the height of a section heading above the first widget: a section
 * is a heading and then its cards, and a widget is a card with its heading
 * inside. With no article published the news section broke that: it drew one
 * dashed card with the heading inside it, so on a new site the widget beside
 * it started 52px lower than the card it sat next to, which
 * `a-column-starts-where-the-one-beside-it-does.spec.ts` measured.
 *
 * Empty, it keeps the heading where every other state draws it, above the card.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/sdk/ui", () => ({
    Pagination: () => null,
    Waiting: ({ label }: { label: string }) => <p>{label}</p>,
    useLocalDate: () => () => "23.10.2026",
}));
// No article is drawn here, so the card and the router behind its link are not either.
vi.mock("@/modules/blog/components/news-card", () => ({ NewsCard: () => null }));

const MESSAGES = {
    ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8")),
    ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/blog/module.json"), "utf8")).translations.en,
};

describe("the news section with nothing published", () => {
    it("draws its heading above the empty card, not inside it", async () => {
        vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ articles: [] })));
        const { BlogNewsSection } = await import("@/modules/blog/components/BlogNewsSection");

        render(
            <NextIntlClientProvider locale="en" messages={MESSAGES} timeZone="UTC">
                <BlogNewsSection />
            </NextIntlClientProvider>,
        );

        const empty = await screen.findByText(MESSAGES.news.empty);
        const heading = screen.getByRole("heading", { level: 2, name: MESSAGES.news.title });
        const card = empty.closest(".border-dashed");

        expect(card, "the empty state is a card").not.toBeNull();
        expect(card!.contains(heading)).toBe(false);
        expect(heading.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        vi.unstubAllGlobals();
    });
});
