/**
 * A theme's text takes site placeholders where its manifest says it may.
 *
 * An operator types `Şu an {servers.online} kişi` into a headline the theme
 * marked `"placeholders": true`, and the theme, which only ever called
 * `get("hero.title")`, draws `Şu an 1.234 kişi`. A field the theme did not
 * mark is drawn as typed: a Discord invite or a server address is not a
 * sentence. Values the server had ready arrive with the page; the ones it did
 * not are asked for once, after it paints.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

const asked = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("@/core/lib/shared-request", () => ({
    sharedJson: async (url: string) => {
        asked.urls.push(url);
        return { values: { "servers.max": 500 } };
    },
}));

const { ThemeConfigProvider, useThemeConfig } = await import("@/core/lib/theme-config-client");
const { PlaceholderProvider } = await import("@/core/components/placeholders/PlaceholderProvider");
const { Placeholder, PlaceholderText } = await import("@/core/components/placeholders/Placeholder");
const { useBlockText } = await import("@/core/hooks/useBlockText");

function Tile({ value }: { value: string }) {
    const text = useBlockText();
    return <p>{text(value)}</p>;
}

function Headline({ path }: { path: string }) {
    const get = useThemeConfig();
    return <p>{get<string>(path, "")}</p>;
}

function page(children: React.ReactNode, pending: string[] = []) {
    return render(
        <NextIntlClientProvider locale="tr" messages={{}}>
            <PlaceholderProvider values={{ "servers.online": 1234, "site.name": "Kayadibi" }} pending={pending}>
                <ThemeConfigProvider
                    value={{ hero: { title: "Şu an {servers.online} kişi", invite: "discord.gg/{servers.online}" } }}
                    placeholderFields={new Set(["hero.title"])}
                >
                    {children}
                </ThemeConfigProvider>
            </PlaceholderProvider>
        </NextIntlClientProvider>,
    );
}

beforeEach(() => {
    asked.urls = [];
});

describe("a theme's text", () => {
    it("is filled where the theme marked it", () => {
        page(<Headline path="hero.title" />);
        expect(screen.getByText("Şu an 1.234 kişi")).toBeTruthy();
    });

    it("is drawn as typed where it did not", () => {
        page(<Headline path="hero.invite" />);
        expect(screen.getByText("discord.gg/{servers.online}")).toBeTruthy();
    });

    it("can be one value or a sentence of the theme's own", () => {
        page(<>
            <span data-testid="one"><Placeholder name="site.name" /></span>
            <span data-testid="sentence"><PlaceholderText text="{site.name}: {servers.max|?}" /></span>
        </>);
        expect(screen.getByTestId("one").textContent).toBe("Kayadibi");
        expect(screen.getByTestId("sentence").textContent).toBe("Kayadibi: ?");
    });

    it("asks once, after painting, for what the server did not have ready", async () => {
        page(<span data-testid="max"><Placeholder name="servers.max" /></span>, ["servers.max"]);
        await waitFor(() => expect(screen.getByTestId("max").textContent).toBe("500"));
        expect(asked.urls).toEqual(["/api/v1/placeholders"]);
    });

    it("asks nothing when everything arrived with the page", () => {
        page(<Placeholder name="servers.online" />);
        expect(asked.urls).toEqual([]);
    });

    it("is filled in a block's words too, a numbers tile among them", () => {
        page(<Tile value="{servers.online}" />);
        expect(screen.getByText("1.234")).toBeTruthy();
    });
});
