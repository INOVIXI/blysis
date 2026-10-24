/**
 * A missing page is drawn inside the site's own frame.
 *
 * The 404 used to be a bare centred card: no bar, no footer, nothing to
 * click but "go home", on a page a visitor reached by following a link
 * that had gone stale. It stands in the shell every page stands in now,
 * and a theme may draw its content as `NotFound`, handed the words core
 * read, so it still renders when the database is why the page is missing.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const slots: { name: string; props: Record<string, unknown> }[] = [];

vi.mock("@/core/lib/i18n/resolve-locale", () => ({
    resolveLocaleFromRequest: async () => "tr",
    notFoundStrings: async () => ({ title: "Sayfa bulunamadı", description: "Taşınmış olabilir.", goHome: "Ana sayfaya dön", search: "Sitede ara" }),
}));
vi.mock("@/core/components/layout/SiteShell", () => ({
    SiteShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock("@/core/components/theme/ThemeComponentSlot", () => ({
    ThemeComponentSlot: ({ name, fallback: Fallback, ...props }: { name: string; fallback: React.ComponentType<Record<string, unknown>> } & Record<string, unknown>) => {
        slots.push({ name, props });
        return <Fallback {...props} />;
    },
}));

const { default: NotFound } = await import("@/app/[locale]/not-found");

describe("a missing page", () => {
    it("stands in the site's frame, with the words core read", async () => {
        render(await NotFound());
        const shell = screen.getByTestId("shell");
        expect(shell.querySelector("h1")?.textContent).toBe("Sayfa bulunamadı");
        expect(screen.getByRole("link", { name: "Ana sayfaya dön" }).getAttribute("href")).toBe("/tr");
    });

    it("lets a theme draw it, handed the same words and where to look", async () => {
        slots.length = 0;
        render(await NotFound());
        expect(slots).toHaveLength(1);
        expect(slots[0].name).toBe("NotFound");
        expect(slots[0].props).toMatchObject({
            title: "Sayfa bulunamadı",
            description: "Taşınmış olabilir.",
            goHome: "Ana sayfaya dön",
            homeHref: "/tr",
            search: "Sitede ara",
            searchHref: "/tr/search",
        });
    });
});
