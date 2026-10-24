// @vitest-environment jsdom
/**
 * A topic can set who wrote each post in a column of its own.
 *
 * The forum drew every post the same way, the author's name and picture on
 * a line above the text, and a theme that wanted the older shape, a column
 * per post that says who is talking and what they are on this site, had no
 * way to ask. The topic block takes a `posts` setting: `stacked` is the page
 * as it was, `columns` sets the author, their role and how long they have
 * been a member beside each post, the opening one included.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me" } } }) }));
vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/forum/topic/t1",
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/forum/module.json"), "utf8"));
const messages = { ...MESSAGES, ...MANIFEST.translations.en, admin: { ...MESSAGES.admin, ...MANIFEST.translations.en.admin } };

const ADMIN = { id: "r-admin", name: "admin", displayName: "Admin", color: "#f26b6b", nameCss: null, badgeCss: null };

const TOPIC = {
    id: "t1",
    title: "Flying on my island does not work",
    slug: "flying",
    content: "I bought the rank and /fly says no.",
    isPinned: false,
    isLocked: false,
    views: 3,
    createdAt: new Date("2026-10-21T19:04:00Z").toISOString(),
    author: { id: "me", username: "mavikaplan", avatar: null, role: null, createdAt: new Date("2026-03-04T12:00:00Z").toISOString() },
    category: { id: "c1", name: "Help", slug: "help", color: null },
    posts: [
        {
            id: "p1",
            content: "Only the owner of the island may fly on it.",
            createdAt: new Date("2026-10-21T19:40:00Z").toISOString(),
            author: { id: "staff", username: "tasci", avatar: null, role: ADMIN, createdAt: new Date("2025-01-10T12:00:00Z").toISOString() },
            _count: { likes: 7 },
            liked: false,
        },
    ],
    _count: { likes: 3 },
};

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ topic: TOPIC, pagination: { pages: 1 } }), { status: 200 })));
});

const { TopicView } = await import("@/modules/forum/components/TopicView");

function draw(postsVariant?: "stacked" | "columns") {
    return render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
            <TopicView initialTopic={TOPIC} initialPostsPages={1} canModerate={false} postsVariant={postsVariant} />
        </NextIntlClientProvider>,
    );
}

function column(text: string) {
    const card = screen.getByText(text).closest("[data-post-card]");
    if (!card) throw new Error(`no post card around "${text}"`);
    const side = card.querySelector("[data-author-column]");
    if (!side) throw new Error(`no author column beside "${text}"`);
    return within(side as HTMLElement);
}

describe("a topic's authors", () => {
    it("stand in a column beside each post, with their role and how long they have been here", () => {
        draw("columns");
        const opener = column("I bought the rank and /fly says no.");
        expect(opener.getByText("mavikaplan")).toBeTruthy();
        expect(opener.getByText(/March 2026/)).toBeTruthy();

        const answer = column("Only the owner of the island may fly on it.");
        expect(answer.getByText("tasci")).toBeTruthy();
        expect(answer.getByText("Admin")).toBeTruthy();
        expect(answer.getByText(/January 2025/)).toBeTruthy();
    });

    it("stay on the line above the post when the page does not ask", () => {
        draw();
        expect(document.querySelector("[data-author-column]")).toBeNull();
        expect(screen.getByText("tasci")).toBeTruthy();
    });
});
