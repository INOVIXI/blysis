// @vitest-environment jsdom
/**
 * A reply can be changed, quoted and taken back, and a refused one says so.
 *
 * `PATCH` and `DELETE /forum/posts/[id]` were written carefully - the author
 * is the author, editing somebody else's post and removing it are two
 * separate grants, both snapshot a revision first - and nothing in the
 * product called either of them. A member who typed a word wrong lived with
 * it, and a moderator who wanted one reply gone had to delete the topic it
 * was in.
 *
 * Replying said nothing when it failed. The handler read `if (res.ok)` and
 * the catch wrote to the console, so a member the site has restricted from
 * the forum, one posting in a section they may not reply in, and one whose
 * reply is too long all pressed the button and watched nothing happen.
 *
 * And there was no way to quote. A forum without quoting is a forum where
 * every long thread becomes "as the person above said".
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const sent: { url: string; method: string; body?: Record<string, unknown> }[] = [];
let reply = { status: 200, body: {} as unknown };

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me" } } }) }));
vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/core/components/ui/confirm-dialog", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/core/components/ui/confirm-dialog")>();
    // Answered yes. That a destructive click asks at all is
    // `a-destructive-click-asks-first`'s guarantee, not this one's.
    return { ...actual, useConfirm: () => ({ confirm: async () => true, ask: async () => null }) };
});
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/forum/topic/t1",
}));
vi.mock("@/core/sdk/layout", () => ({
    PageFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/forum/module.json"), "utf8"));
const messages = { ...MESSAGES, ...MANIFEST.translations.en, admin: { ...MESSAGES.admin, ...MANIFEST.translations.en.admin } };

const TOPIC = {
    id: "t1",
    title: "How do I link my account?",
    slug: "how-do-i-link-my-account",
    content: "The opening post.",
    isPinned: false,
    isLocked: false,
    views: 3,
    createdAt: new Date("2026-09-01").toISOString(),
    author: { id: "me", username: "aeryn", avatar: null },
    category: { id: "c1", name: "Support", slug: "support", color: null },
    posts: [
        {
            id: "p1",
            content: "Try the profile page.",
            createdAt: new Date("2026-09-02").toISOString(),
            author: { id: "me", username: "aeryn", avatar: null },
            _count: { likes: 0 },
            liked: false,
        },
        {
            id: "p2",
            content: "That worked, thank you.",
            createdAt: new Date("2026-09-03").toISOString(),
            author: { id: "someone-else", username: "bolt", avatar: null },
            _count: { likes: 0 },
            liked: false,
        },
    ],
    _count: { likes: 0 },
};

beforeEach(() => {
    sent.length = 0;
    reply = { status: 200, body: {} };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        sent.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === "GET") return new Response(JSON.stringify({ topic: TOPIC, pagination: { pages: 1 } }), { status: 200 });
        return new Response(JSON.stringify(reply.body), { status: reply.status });
    }));
});

const { TopicView } = await import("@/modules/forum/components/TopicView");

function draw(canModerate = false) {
    return render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <TopicView initialTopic={TOPIC} initialPostsPages={1} canModerate={canModerate} />
        </NextIntlClientProvider>,
    );
}

function postRow(text: string) {
    const found = screen.getByText(text);
    const card = found.closest("[data-post]");
    if (!card) throw new Error(`no post around "${text}"`);
    return within(card as HTMLElement);
}

describe("a reply of your own", () => {
    it("can be changed", async () => {
        draw();
        fireEvent.click(postRow("Try the profile page.").getByRole("button", { name: /edit/i }));
        const box = await screen.findByDisplayValue("Try the profile page.");
        fireEvent.change(box, { target: { value: "Try the profile screen." } });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
        await waitFor(() =>
            expect(sent.some((r) => r.method === "PATCH" && r.url.endsWith("/forum/posts/p1"))).toBe(true),
        );
        // Not `at(-1)`: saving refetches the topic, so the read lands after
        // the write.
        const patch = sent.find((r) => r.method === "PATCH");
        expect(patch?.body?.content).toBe("Try the profile screen.");
    });

    it("can be taken back", async () => {
        draw();
        fireEvent.click(postRow("Try the profile page.").getByRole("button", { name: /delete/i }));
        await waitFor(() =>
            expect(sent.some((r) => r.method === "DELETE" && r.url.endsWith("/forum/posts/p1"))).toBe(true),
        );
    });
});

describe("somebody else's reply", () => {
    it("offers nothing to a member", () => {
        draw();
        expect(postRow("That worked, thank you.").queryByRole("button", { name: /edit/i })).toBeNull();
        expect(postRow("That worked, thank you.").queryByRole("button", { name: /delete/i })).toBeNull();
    });

    it("can be worked on by somebody the site trusts with them", () => {
        draw(true);
        expect(postRow("That worked, thank you.").getByRole("button", { name: /edit/i })).toBeTruthy();
    });

    it("can be quoted by anybody who can reply", async () => {
        draw();
        fireEvent.click(postRow("That worked, thank you.").getByRole("button", { name: /quote/i }));
        const box = await screen.findByLabelText(/write your reply/i);
        expect((box as HTMLTextAreaElement).value).toContain("> That worked, thank you.");
        expect((box as HTMLTextAreaElement).value).toContain("bolt");
    });
});

describe("a reply the site refuses", () => {
    it("says why, instead of writing it to the console", async () => {
        reply = { status: 403, body: { error: "You cannot reply at the moment", code: "restricted_from_forum" } };
        draw();
        fireEvent.change(screen.getByLabelText(/write your reply/i), { target: { value: "hello" } });
        fireEvent.click(screen.getByRole("button", { name: /post reply/i }));
        const { toast } = await import("sonner");
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
    });
});

describe("the box a reply is written in", () => {
    it("holds the line the endpoint holds", () => {
        draw();
        const box = screen.getByLabelText(/write your reply/i) as HTMLTextAreaElement;
        expect(box.maxLength).toBe(50_000);
    });
});

describe("a topic the panel lists", () => {
    const read = (rel: string) =>
        fs.readFileSync(path.join(process.cwd(), "module-sources/forum", rel), "utf8");

    it("can be hidden without being deleted", () => {
        /*
         * `moderationState` has always decided what a visitor sees - every
         * read asks for `APPROVED` - and the only screen that could write it
         * was the moderation queue, which lists what is waiting. So a topic
         * already approved could not be taken down at all except by deleting
         * it, which loses what it said.
         */
        const screen = read("pages/admin/topics/page.tsx");
        expect(screen).toContain("moderationState");
        expect(screen).toContain("adm_hide");
        expect(screen).toContain("adm_show");
        expect(read("api/topics/[id]/route.ts")).toContain("fields.moderationState");
        expect(read("lib/validations.ts")).toContain('z.enum(["APPROVED", "REJECTED"])');
    });

    it("says on the row when it is hidden", () => {
        expect(read("pages/admin/topics/page.tsx")).toContain("adm_hidden");
    });

    it("has a word for each of those in both languages", () => {
        const manifest = JSON.parse(read("module.json"));
        for (const locale of ["en", "tr"]) {
            const forum = manifest.translations[locale].forum;
            for (const key of ["adm_hide", "adm_show", "adm_hidden", "quote", "editPost",
                               "replyFailed", "replyRoomLeft", "deletePostConfirm"]) {
                expect(typeof forum[key], `${locale} ${key}`).toBe("string");
            }
            expect(typeof forum.err.restricted_from_forum, `${locale} err.restricted_from_forum`).toBe("string");
        }
    });
});
