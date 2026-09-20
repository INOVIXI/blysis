// @vitest-environment jsdom
/**
 * The help centre's own list can be worked.
 *
 * The screen could create an article and a category and then nothing else.
 * Fourteen articles sat in a table with no action on any row: no edit, no
 * delete, no way to tick two of them, and a typo in a title was permanent.
 * The endpoints for all of it had been written - `PATCH` and `DELETE` on both
 * `/help/articles/[slug]` and `/help/categories/[id]` - and the screen called
 * neither, so a module shipped an admin surface that could only ever grow.
 *
 * The categories tab was worse: a grid of cards with no controls at all, and
 * the article count under each one read "3 articles" in English on a Turkish
 * panel, written into the JSX.
 *
 * A category that still holds articles is refused by the endpoint, and that
 * refusal is a sentence a person reads: it arrives as a code and the screen
 * says it in the reader's language rather than printing the endpoint's
 * English.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const asked: string[] = [];
const sent: { url: string; method: string; body?: unknown }[] = [];
const pushed: string[] = [];
let search = new URLSearchParams();
let categoryDeleteAnswer = { status: 200, body: { ok: true } as unknown };

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a href={href} {...rest}>{children}</a>
    ),
    useRouter: () => ({ push: (url: string) => pushed.push(url) }),
}));
vi.mock("next/navigation", () => ({
    useSearchParams: () => search,
}));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    usePathname: () => "/admin/help",
    useRouter: () => ({ push: (url: string) => pushed.push(url), replace: () => {} }),
}));
vi.mock("@/core/components/ui/confirm-dialog", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/core/components/ui/confirm-dialog")>();
    return {
        ...actual,
        // Answered yes, and recorded. That a destructive click asks at all is
        // `a-destructive-click-asks-first`'s guarantee, not this one's.
        useConfirm: () => ({
            confirm: async (options: { message: string }) => { asked.push(options.message); return true; },
            ask: async () => null,
        }),
    };
});

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/help-center/module.json"), "utf8"));
// Namespace by namespace: the module declares an `admin` block of its own and
// spreading it whole would take core's with it, which is where the shared
// shell keeps its words.
function catalogue(locale: "en" | "tr") {
    const core = JSON.parse(fs.readFileSync(path.join(process.cwd(), `messages-core/${locale}.json`), "utf8"));
    const mine = MANIFEST.translations[locale];
    const merged: Record<string, unknown> = { ...core };
    for (const [namespace, entries] of Object.entries(mine)) {
        merged[namespace] = { ...(core[namespace] ?? {}), ...(entries as object) };
    }
    return merged;
}

const messages = catalogue("en") as Record<string, Record<string, string>>;

const ARTICLES = [
    {
        id: "a1", title: "How to appeal a ban", slug: "how-to-appeal-a-ban",
        content: "Write to us.", views: 12, helpful: 2, notHelpful: 4, isActive: true,
        category: { id: "c1", name: "Rules" },
    },
];
const CATEGORIES = [
    { id: "c1", name: "Rules", slug: "rules", description: null, icon: "Rocket", isActive: true, _count: { articles: 1 } },
];

beforeEach(() => {
    asked.length = 0;
    sent.length = 0;
    pushed.length = 0;
    search = new URLSearchParams();
    categoryDeleteAnswer = { status: 200, body: { ok: true } };
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
            const method = init?.method ?? "GET";
            sent.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
            if (method === "DELETE" && String(url).includes("/help/categories/")) {
                return new Response(JSON.stringify(categoryDeleteAnswer.body), { status: categoryDeleteAnswer.status });
            }
            if (String(url).includes("/help/categories")) {
                return new Response(JSON.stringify({ categories: CATEGORIES }), { status: 200 });
            }
            if (String(url).includes("/help/articles")) {
                return new Response(
                    JSON.stringify({
                        articles: ARTICLES,
                        pagination: { page: 1, perPage: 25, total: ARTICLES.length, pages: 1 },
                    }),
                    { status: 200 },
                );
            }
            return new Response("{}", { status: 200 });
        }),
    );
});

const { default: AdminHelpCenterPage } = await import("@/modules/help-center/pages/admin/help/page");

function draw() {
    return render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <AdminHelpCenterPage />
        </NextIntlClientProvider>,
    );
}

async function drawn() {
    const view = draw();
    await screen.findByText("How to appeal a ban");
    return view;
}

function row(text: string) {
    const cell = screen.getByText(text);
    const tr = cell.closest("tr");
    if (!tr) throw new Error(`no row around "${text}"`);
    return within(tr);
}

describe("the list the panel reads", () => {
    it("is the operator's, so a hidden article is still on it", async () => {
        await drawn();
        const reads = sent.filter((r) => r.method === "GET");
        expect(reads.every((r) => r.url.includes("scope=admin"))).toBe(true);
    });

    it("is paged by the database rather than by the browser", async () => {
        await drawn();
        expect(sent.some((r) => r.url.includes("/help/articles") && r.url.includes("perPage="))).toBe(true);
    });
});

describe("an article in the list", () => {
    it("can be taken away", async () => {
        await drawn();
        fireEvent.click(row("How to appeal a ban").getByRole("button", { name: /delete/i }));
        await waitFor(() =>
            expect(sent.some((r) => r.method === "DELETE" && r.url.endsWith("/help/articles/how-to-appeal-a-ban"))).toBe(true),
        );
        expect(asked.length).toBe(1);
    });

    it("can be opened to be changed, at an address of its own", async () => {
        await drawn();
        fireEvent.click(row("How to appeal a ban").getByRole("button", { name: /edit/i }));
        await waitFor(() => expect(pushed.at(-1)).toContain("form=article:how-to-appeal-a-ban"));
    });
});

describe("the form an article is changed on", () => {
    it("opens holding what the article says", async () => {
        search = new URLSearchParams("form=article:how-to-appeal-a-ban");
        draw();
        await waitFor(() => {
            const title = screen.getByLabelText(/title/i) as HTMLInputElement;
            expect(title.value).toBe("How to appeal a ban");
        });
    });

    it("saves onto the article rather than writing a second one", async () => {
        search = new URLSearchParams("form=article:how-to-appeal-a-ban");
        draw();
        await screen.findByDisplayValue("How to appeal a ban");
        fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "How to appeal" } });
        fireEvent.click(screen.getByRole("button", { name: /save|update/i }));
        await waitFor(() =>
            expect(sent.some((r) => r.method === "PATCH" && r.url.endsWith("/help/articles/how-to-appeal-a-ban"))).toBe(true),
        );
    });
});

describe("more than one article at once", () => {
    it("can be ticked and taken away together", async () => {
        await drawn();
        fireEvent.click(row("How to appeal a ban").getByRole("checkbox"));
        fireEvent.click(screen.getByRole("button", { name: /delete 1/i }));
        await waitFor(() =>
            expect(sent.filter((r) => r.method === "DELETE" && r.url.includes("/help/articles/")).length).toBe(1),
        );
    });
});

describe("a category", () => {
    async function onTheCategoriesTab() {
        await drawn();
        fireEvent.click(screen.getByRole("button", { name: /categories/i }));
        await screen.findByText("Rules");
    }

    it("can be taken away", async () => {
        await onTheCategoriesTab();
        fireEvent.click(row("Rules").getByRole("button", { name: /delete/i }));
        await waitFor(() =>
            expect(sent.some((r) => r.method === "DELETE" && r.url.endsWith("/help/categories/c1"))).toBe(true),
        );
    });

    it("says in the reader's language why one holding articles cannot go", async () => {
        categoryDeleteAnswer = { status: 409, body: { error: "Cannot delete: category has 1 article(s).", code: "category_has_articles" } };
        await onTheCategoriesTab();
        fireEvent.click(row("Rules").getByRole("button", { name: /delete/i }));
        const { toast } = await import("sonner");
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
        const said = String((toast.error as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? "");
        expect(said).toBe(messages.helpCenter.adm_categoryHasArticles);
        expect(said).not.toContain("Cannot delete");
    });

    it("wears its icon rather than the word the icon is called", async () => {
        // The mark beside a category is stored as a lucide name - "Rocket",
        // "ShoppingBag" - and the screen printed it. Four rows read "Rocket
        // Getting started" and "ShoppingBag Purchases", which is a column of
        // identifiers sitting where names go.
        await onTheCategoriesTab();
        expect(screen.queryByText("Rocket")).toBeNull();
    });

    it("counts its articles in a sentence somebody wrote, not in the source", async () => {
        // Read in Turkish on purpose. The English catalogue happens to say
        // the same words the JSX used to hold, so only the other locale can
        // tell a translated count from a hardcoded one.
        render(
            <NextIntlClientProvider locale="tr" messages={catalogue("tr") as Record<string, Record<string, string>>}>
                <AdminHelpCenterPage />
            </NextIntlClientProvider>,
        );
        const tabs = await screen.findAllByRole("button", { name: /kategoriler/i });
        fireEvent.click(tabs[tabs.length - 1]);
        expect(await screen.findByText("1 makale")).toBeTruthy();
    });
});
