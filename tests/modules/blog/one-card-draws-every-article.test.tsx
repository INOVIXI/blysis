/**
 * The card an article is drawn as, wherever it is drawn.
 *
 * The homepage news section and the blog index showed the same articles in two
 * different cards, and the one on the index was wrong twice over.
 *
 * It read the picture from `post.image`. Articles carry `coverImage`, which is
 * what the index query selects and what the grid's own interface declares, so
 * the field was always undefined and the card was written to render no picture
 * at all when it is missing. Every card on the blog index was a bare box, and
 * nothing failed: an optional field that is always absent looks exactly like a
 * site whose authors have not uploaded anything.
 *
 * It also linked to `/blog/<slug>`. Every other link to an article in this
 * module - the sidebar, the related list, the homepage - is
 * `/blog/<number>/<slug>`.
 *
 * So there is one card now and both places use it. A missing picture keeps its
 * space rather than collapsing the card, because two cards side by side should
 * not be different heights depending on who uploaded what.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { NewsCard } from "@/modules/blog/components/news-card";

vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a href={href} {...rest}>{children}</a>
    ),
}));
vi.mock("@/core/sdk/ui", () => ({
    useLocalDate: () => () => "30.01.2026",
    Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("next/image", () => ({
    default: ({ src, alt }: { src: string; alt: string }) =>
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} />,
}));

const article = {
    id: "a1",
    number: 7,
    title: "Backups now run twice a day",
    slug: "backups-now-run-twice-a-day",
    excerpt: "The change is live now.",
    coverImage: "/uploads/cover.png",
    publishedAt: "2026-01-30T00:00:00.000Z",
    createdAt: "2026-01-30T00:00:00.000Z",
    category: { name: "Improvement", slug: "improvement" },
};

describe("an article card", () => {
    it("draws the cover the article actually carries", () => {
        const { container } = render(<NewsCard post={article} />);
        const img = container.querySelector("img");
        expect(img, "no picture was rendered at all").toBeTruthy();
        expect(img!.getAttribute("src")).toContain("cover.png");
    });

    it("links the way every other link to an article does", () => {
        const { container } = render(<NewsCard post={article} />);
        expect(container.querySelector("a")!.getAttribute("href"))
            .toBe("/blog/7/backups-now-run-twice-a-day");
    });

    it("keeps the picture's space when there is no picture", () => {
        // Otherwise one card in a row is shorter than the one beside it, and
        // the grid goes ragged as soon as an author skips a cover. It is a
        // ratio rather than a fixed height, so the space holds at every
        // column count instead of only at the one somebody measured.
        //
        // `aspect-card` is the site's one cover shape, declared in
        // `globals.css` and held to 2:1 by `a-cover-is-two-to-one`: an article
        // cover is framed the way a product banner beside it is.
        const { container } = render(<NewsCard post={{ ...article, coverImage: null }} />);
        expect(container.querySelector("img")).toBeNull();
        expect(container.innerHTML).toContain("aspect-card");
    });

    it("names the section the article is in", () => {
        // On the picture rather than in the body: the category is what a
        // reader scans a row of cards for, and it was a line of small grey
        // text under the fold of the card.
        const { getByText } = render(<NewsCard post={article} />);
        expect(getByText("Improvement")).toBeTruthy();
    });

    it("says what it is about", () => {
        const { getByText } = render(<NewsCard post={article} />);
        expect(getByText(article.title)).toBeTruthy();
        expect(getByText(article.excerpt)).toBeTruthy();
    });
});
