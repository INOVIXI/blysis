// @vitest-environment jsdom
/**
 * The panel's search finds a screen by the name the panel calls it.
 *
 * Measured on 2026-09-20 against this tree, in Turkish, which is the language
 * the panel was in: "kullan" found nothing, "ayar" found nothing, "yard" found
 * nothing. "user" found one thing and "settings" found twenty. The reason was
 * a list of twelve English titles written into the search endpoint - a hand
 * copy of the sidebar, described in its own comment as "mirrors AdminSidebar's
 * labels but flat" - plus a pass over module routes that scored the URL and
 * titled the result with its last segment. So searching the Turkish panel
 * worked only if you guessed the English word, and half the answers were
 * identifiers: "apple-auth | apple-auth".
 *
 * The sidebar already knows every screen this panel has and what each one is
 * called in the reader's language. The palette reads that instead of a second
 * list that drifts: nothing to keep in step, and every screen the panel offers
 * is findable in the language it is offered in.
 *
 * Two smaller things measured at the same time. The footer read "⌘K to
 * toggle", three translated words and then an English one. And a result
 * carried its `type` in the corner - "module-page", "settings" - which is how
 * the code sorts them, not a word anybody reads.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const pushed: string[] = [];

vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: (url: string) => pushed.push(url) }),
    usePathname: () => "/admin",
}));

const TR = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/tr.json"), "utf8"));

let answer: unknown = { results: [] };

beforeEach(() => {
    pushed.length = 0;
    answer = { results: [] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 })));
});

const { AdminSpotlight } = await import("@/core/components/admin/AdminSpotlight");

function open(modules: { id: string; menu?: { path: string; label: string }[] }[] = []) {
    render(
        <NextIntlClientProvider locale="tr" messages={TR}>
            <AdminSpotlight modules={modules} activeThemeId="default" />
        </NextIntlClientProvider>,
    );
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    return screen.getByRole("textbox");
}

describe("the panel's palette", () => {
    it("finds a screen by the name the panel calls it, in the reader's language", async () => {
        const box = open();
        fireEvent.change(box, { target: { value: "kullan" } });
        expect(await screen.findByText("Kullanıcılar")).toBeTruthy();
    });

    it("finds a screen a module contributed, by the name its menu gives it", async () => {
        const box = open([{ id: "help-center", menu: [{ path: "/help", label: "Yardım Merkezi" }] }]);
        fireEvent.change(box, { target: { value: "yard" } });
        expect(await screen.findByText("Yardım Merkezi")).toBeTruthy();
    });

    it("opens what was chosen", async () => {
        const box = open();
        fireEvent.change(box, { target: { value: "kullan" } });
        fireEvent.click(await screen.findByText("Kullanıcılar"));
        await waitFor(() => expect(pushed.at(-1)).toContain("/admin/users"));
    });

    it("says the shortcut in the reader's language", () => {
        open();
        expect(screen.queryByText(/to toggle/i)).toBeNull();
    });

    it("draws no machine name beside a result", async () => {
        answer = {
            results: [
                { type: "module-page", id: "x", title: "Lisans Anahtarları", subtitle: "/admin/licenses", href: "/admin/licenses" },
            ],
        };
        const box = open();
        fireEvent.change(box, { target: { value: "lisans" } });
        expect(await screen.findByText("Lisans Anahtarları")).toBeTruthy();
        expect(screen.queryByText("module-page")).toBeNull();
    });
});

describe("the panel's header", () => {
    it("holds one way to search, not two", () => {
        const layout = fs.readFileSync(
            path.join(process.cwd(), "src/app/[locale]/(admin)/admin/layout.tsx"),
            "utf8",
        );
        // The box in the header used to have a dropdown of its own, reading
        // the same endpoint and drawing the answers a second way. It opens
        // the palette now.
        expect(layout).not.toContain("AdminSearch");
    });
});
