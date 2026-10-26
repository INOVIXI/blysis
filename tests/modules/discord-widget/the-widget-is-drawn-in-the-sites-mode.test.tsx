/**
 * Discord's widget is drawn in the mode the site is in.
 *
 * It asked whether `<html>` had a `data-mode` at all, and the site always
 * writes one, `light` or `dark`. So a light page carried Discord's dark
 * widget: a black panel in a white sidebar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const { DiscordWidget } = await import("@/modules/discord-widget/widgets/discord-widget");

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ serverId: "123456789012345678" }) })));
});

afterEach(() => {
    document.documentElement.removeAttribute("data-mode");
    vi.unstubAllGlobals();
});

async function widgetTheme() {
    const { container } = render(<DiscordWidget />);
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    return new URL(container.querySelector("iframe")!.getAttribute("src")!).searchParams.get("theme");
}

describe("the Discord widget", () => {
    it("is light on a light page", async () => {
        document.documentElement.setAttribute("data-mode", "light");
        expect(await widgetTheme()).toBe("light");
    });

    it("is dark on a dark page", async () => {
        document.documentElement.setAttribute("data-mode", "dark");
        expect(await widgetTheme()).toBe("dark");
    });

    it("follows the page when the reader switches mode", async () => {
        document.documentElement.setAttribute("data-mode", "light");
        const { container } = render(<DiscordWidget />);
        await waitFor(() => expect(container.querySelector("iframe")?.getAttribute("src")).toContain("theme=light"));
        document.documentElement.setAttribute("data-mode", "dark");
        await waitFor(() => expect(container.querySelector("iframe")?.getAttribute("src")).toContain("theme=dark"));
    });
});
