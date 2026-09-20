// @vitest-environment jsdom
/**
 * A popup is something the site says to a visitor, so it is drawn where a
 * visitor is reading.
 *
 * The slot it mounts in sits in the locale layout, which wraps the panel and
 * the sign-in pages as well as the site. Measured on 2026-09-20 by seeding
 * one: the dialog opened over the admin panel, and over the sign-in form -
 * where its scrim takes the clicks, so somebody trying to sign in has to
 * dismiss a marketing dialog first. A script doing the same thing could not
 * get past it at all.
 *
 * Nobody meant that. An operator writing "Season 4 starts Friday" is talking
 * to the people on the site, not to themselves at work.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

const path = { value: "/store" };

vi.mock("@/core/sdk/navigation", () => ({
    usePathname: () => path.value,
}));

vi.mock("@/core/sdk/ui", () => ({
    useModalDialog: () => ({ current: null }),
}));

beforeEach(() => {
    localStorage.clear();
    path.value = "/store";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
        JSON.stringify({ popups: [{ id: "p1", title: "Season 4 starts Friday", content: "It resets at 18:00." }] }),
        { status: 200 },
    )));
});

const { default: PopupRenderer } = await import("../../../module-sources/popups/slots/PopupRenderer");

function draw() {
    render(
        <NextIntlClientProvider locale="en" messages={{ popups: { close: "Close" } }}>
            <PopupRenderer />
            {/* Rendered beside it, so a test can wait for the tree to exist
                rather than for a dialog that is absent either way. */}
            <span data-testid="settled" />
        </NextIntlClientProvider>,
    );
}

describe("where a popup is drawn", () => {
    it("is a page of the site", async () => {
        draw();
        expect(await screen.findByText("Season 4 starts Friday")).toBeTruthy();
    });
});

describe("where a popup is not drawn", () => {
    /**
     * Drawn nothing and asked nothing. Waiting for the dialog to be absent
     * proves nothing on its own - it is absent for a moment on every page,
     * while the read is in flight - so the read not happening is the half
     * that holds.
     */
    async function nothingHappens() {
        draw();
        await screen.findByTestId("settled");
        expect(fetch).not.toHaveBeenCalled();
        expect(screen.queryByText("Season 4 starts Friday")).toBeNull();
    }

    it("is not over the panel an operator is working in", async () => {
        path.value = "/admin/popups";
        await nothingHappens();
    });

    it("is not over the form somebody is signing in with", async () => {
        path.value = "/auth/login";
        await nothingHappens();
    });
});
