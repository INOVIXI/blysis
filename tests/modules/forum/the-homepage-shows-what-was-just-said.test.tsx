/**
 * The homepage can show the forum's newest topics.
 *
 * The forum had no widget, so a site's front page said nothing about the
 * part of it that changes most. And the topic list it could have read puts
 * pinned topics first, which is right for the forum's own page and wrong for
 * "what is new": the same three pinned rules threads would have stood at the
 * top of the homepage forever. The list takes `order=newest` for that.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

const calls = vi.hoisted(() => ({ findMany: [] as Record<string, unknown>[] }));

vi.mock("@/core/sdk/server", () => ({
    refuseSilenced: vi.fn(),
    isRestrictedFrom: vi.fn(),
    pageParams: (params: URLSearchParams, { defaultLimit }: { defaultLimit: number }) => {
        const limit = Number(params.get("limit") ?? defaultLimit);
        return { page: 1, limit, skip: 0, take: limit };
    },
    isAdmin: vi.fn(async () => false),
    moduleSettings: vi.fn(async () => ({ topicsPerPage: 20 })),
    rateLimitForRole: vi.fn(),
    readJsonBody: vi.fn(),
    prisma: {
        forumTopic: {
            findMany: vi.fn(async (args: Record<string, unknown>) => {
                calls.findMany.push(args);
                return [];
            }),
            count: vi.fn(async () => 0),
        },
    },
}));
vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/modules/forum/lib/visible-categories", () => ({ visibleCategoryIds: vi.fn(async () => ({ everything: true, categoryIds: [] })) }));
vi.mock("@/modules/forum/lib/guest-view", () => ({ denyGuestView: vi.fn(async () => null) }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
    usePathname: () => "/",
    useRouter: () => ({ push: () => {} }),
}));

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/forum/module.json"), "utf8"));
const { GET } = await import("@/modules/forum/api/topics/route");
const { LatestTopicsWidget } = await import("@/modules/forum/widgets/latest-topics-widget");

beforeEach(() => {
    calls.findMany = [];
});

describe("the topic list", () => {
    it("puts pinned topics first on the forum's own page", async () => {
        await GET(new NextRequest("https://example.com/api/v1/forum/topics"));
        expect(calls.findMany[0].orderBy).toEqual([{ isPinned: "desc" }, { createdAt: "desc" }]);
    });

    it("is newest first, pinned or not, when asked for what is new", async () => {
        await GET(new NextRequest("https://example.com/api/v1/forum/topics?order=newest&limit=5"));
        expect(calls.findMany[0].orderBy).toEqual([{ createdAt: "desc" }]);
        expect(calls.findMany[0].take).toBe(5);
    });
});

describe("the latest topics widget", () => {
    function draw(topics: unknown[], locale = "tr") {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ topics }) })));
        return render(
            <NextIntlClientProvider locale={locale} messages={MANIFEST.translations[locale]}>
                <LatestTopicsWidget />
            </NextIntlClientProvider>,
        );
    }

    it("asks for the newest few, not the pinned ones", async () => {
        draw([]);
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        const url = String(vi.mocked(fetch).mock.calls[0][0]);
        expect(url).toContain("/api/v1/forum/topics");
        expect(url).toContain("order=newest");
    });

    it("links each topic to its page, with who started it", async () => {
        draw([
            { id: "t1", number: 7, slug: "sezon-dort", title: "Sezon dört hakkında", createdAt: "2026-10-23T10:00:00Z", author: { username: "ada" }, category: { name: "Genel", color: null }, _count: { posts: 3 } },
        ]);
        const link = await screen.findByRole("link", { name: /Sezon dört hakkında/ });
        expect(link.getAttribute("href")).toBe("/forum/topic/7/sezon-dort");
        expect(screen.getByText(/ada/)).toBeTruthy();
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(MANIFEST.translations.tr.forum.widget_latestTitle);
    });

    it("draws nothing on a forum with no topics", async () => {
        const { container } = draw([]);
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(container.innerHTML).toBe("");
    });

    it("speaks every language the module does", () => {
        for (const [locale, catalogue] of Object.entries(MANIFEST.translations as Record<string, { forum: Record<string, string>; admin: Record<string, string> }>)) {
            for (const key of ["widget_latestTitle", "widget_latestBy", "widget_latestAll"]) {
                expect(catalogue.forum[key], `${locale} forum.${key}`).toBeTruthy();
            }
            expect(catalogue.admin.widget_forumLatest, `${locale} admin.widget_forumLatest`).toBeTruthy();
        }
    });
});
