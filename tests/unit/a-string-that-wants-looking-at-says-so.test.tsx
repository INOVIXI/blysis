// @vitest-environment jsdom
/**
 * A string that wants looking at says so where the operator is working on it,
 * with its answers beside it, and its earlier versions are a click away.
 *
 * The flags and versions the endpoint keeps are worth nothing if the list
 * shows a string the same whether an update moved its original or not. The
 * card says which it is, prints both originals for a review, and carries the
 * two answers each notice has. The history is read only when opened, and
 * each version in it offers the way back.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import { TranslationEntry, type Entry } from "@/app/[locale]/(admin)/admin/translations/TranslationEntry";

const EN = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const ENTRY: Entry = {
    namespace: "store",
    key: "title",
    sources: ["store"],
    locales: {
        en: { value: "Store", from: "store", isCustom: false, shipped: "Store", review: null, awaiting: false },
        tr: { value: "Market", from: "store", isCustom: true, shipped: "Dükkan", review: { was: "Mağaza", now: "Dükkan" }, awaiting: true },
    },
};

const handlers = () => ({
    onSave: vi.fn(async () => true),
    onRestore: vi.fn(async () => true),
    onAdopt: vi.fn(async () => true),
    onMark: vi.fn(async () => true),
    onUndo: vi.fn(async () => true),
});

function draw(on: ReturnType<typeof handlers>, entry: Entry = ENTRY) {
    render(
        <NextIntlClientProvider locale="en" messages={EN} timeZone="UTC">
            <TranslationEntry entry={entry} labelOf={(s) => s} source="en" target="tr" {...on} />
        </NextIntlClientProvider>,
    );
}

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        ok: true,
        data: { items: [{ id: "v1", createdAt: "2026-10-26T10:00:00Z", author: "ada", cause: "edit", locales: { tr: { value: "Mağaza", isCustom: false } } }] },
    }))));
});

describe("a string an update changed under the site's edit", () => {
    it("says what the original said and says now", () => {
        draw(handlers());
        expect(screen.getByText(EN.admin.translations_toReview)).toBeTruthy();
        expect(screen.getByText("Then: Mağaza")).toBeTruthy();
        expect(screen.getByText("Now: Dükkan")).toBeTruthy();
    });

    it("keeps the operator's words, or takes the new original", async () => {
        const on = handlers();
        draw(on);
        fireEvent.click(screen.getByRole("button", { name: EN.admin.translations_keepMine }));
        await waitFor(() => expect(on.onMark).toHaveBeenCalledWith("review"));
        fireEvent.click(screen.getByRole("button", { name: EN.admin.translations_useNew }));
        await waitFor(() => expect(on.onAdopt).toHaveBeenCalled());
    });
});

describe("a string that changed in another language", () => {
    it("can be marked still right", async () => {
        const on = handlers();
        draw(on);
        expect(screen.getByText(EN.admin.translations_awaitingNote)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: EN.admin.translations_stillRight }));
        await waitFor(() => expect(on.onMark).toHaveBeenCalledWith("translate"));
    });

    it("says nothing of the kind when nothing is asked of it", () => {
        const plain = { ...ENTRY, locales: { ...ENTRY.locales, tr: { ...ENTRY.locales.tr, review: null, awaiting: false } } };
        draw(handlers(), plain);
        expect(screen.queryByText(EN.admin.translations_toReview)).toBeNull();
        expect(screen.queryByText(EN.admin.translations_awaitingNote)).toBeNull();
    });
});

describe("a string's history", () => {
    it("is read when opened, and each version offers the way back", async () => {
        const on = handlers();
        draw(on);
        expect(fetch).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: EN.admin.translations_history }));
        await screen.findByText(/Edited by ada/);
        expect(screen.getByText("Mağaza")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: EN.admin.translations_undo }));
        await waitFor(() => expect(on.onUndo).toHaveBeenCalledWith("v1"));
    });
});
