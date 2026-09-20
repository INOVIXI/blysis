// @vitest-environment jsdom
/**
 * A row an operator switched off does not look like one that is live.
 *
 * Measured across the panel on 2026-09-20: thirteen module screens are drawn
 * by the crud shell, twelve of them declare a toggle that decides whether the
 * row is live, and not one of them drew it in the list. So a deactivated
 * download, announcement, slide, vote site, staff member, bulk discount,
 * creator code, wheel, prize, popup, department or server was indistinguishable
 * from a working one until somebody opened it. An operator turning something
 * off and looking at the list has no way to confirm they did.
 *
 * The shell already holds the field definitions, so the mark belongs there
 * rather than in twelve `secondaryRender`s that would each word it differently
 * and each be forgotten by the thirteenth screen.
 *
 * Only the off row is marked. A list where every row carries a badge saying
 * "Active" has spent the reader's attention on the ordinary case and has
 * nothing left for the exception, which is the one they are looking for.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/admin/downloads",
    useSearchParams: () => new URLSearchParams(),
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const ROWS = [
    { id: "1", name: "Server rules", isActive: true },
    { id: "2", name: "Client pack", isActive: false },
    { id: "3", name: "Texture pack", isActive: true },
];

beforeEach(() => {
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ items: ROWS }), { status: 200 })),
    );
});

const { AdminCrudPage } = await import("@/core/components/admin/AdminCrudPage");

function draw(fields: { key: string; label: string; type?: string }[], activeField?: string) {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <AdminCrudPage
                title="Downloads"
                subtitle="Files this site offers"
                apiPath="/api/v1/downloads"
                listKey="items"
                displayField="name"
                activeField={activeField}
                fields={fields as never}
            />
        </NextIntlClientProvider>,
    );
}

/** The row's own box, so a mark is read against the row it belongs to. */
function rowNamed(name: string): HTMLElement {
    const title = screen.getByText(name);
    const row = title.closest("div.flex.items-center");
    if (!row) throw new Error(`no row around ${name}`);
    return row as HTMLElement;
}

const WITH_A_SWITCH = [
    { key: "name", label: "File name", type: "text" },
    { key: "isActive", label: "Active", type: "toggle" },
];

describe("a list of rows with a switch", () => {
    it("marks the row that is off", async () => {
        draw(WITH_A_SWITCH);
        await waitFor(() => expect(screen.getByText("Client pack")).toBeTruthy());

        expect(rowNamed("Client pack").textContent).toContain("Not Active");
    });

    it("says nothing on the rows that are on", async () => {
        draw(WITH_A_SWITCH);
        await waitFor(() => expect(screen.getByText("Server rules")).toBeTruthy());

        expect(rowNamed("Server rules").textContent).not.toContain("Not Active");
        expect(rowNamed("Texture pack").textContent).not.toContain("Not Active");
    });

    it("uses the field's own word, because the screen names its own switch", async () => {
        draw([
            { key: "name", label: "File name", type: "text" },
            { key: "isActive", label: "Published", type: "toggle" },
        ]);
        await waitFor(() => expect(screen.getByText("Client pack")).toBeTruthy());

        expect(rowNamed("Client pack").textContent).toContain("Not Published");
    });
});

describe("a screen whose switch is called something else", () => {
    it("marks the row when it says which field decides", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(
                JSON.stringify({ items: [{ id: "1", name: "Client pack", enabled: false }] }),
                { status: 200 },
            )),
        );
        draw([
            { key: "name", label: "File name", type: "text" },
            { key: "enabled", label: "Enabled", type: "toggle" },
        ], "enabled");
        await waitFor(() => expect(screen.getByText("Client pack")).toBeTruthy());

        expect(rowNamed("Client pack").textContent).toContain("Not Enabled");
    });
});

describe("a list with no switch at all", () => {
    it("is left alone", async () => {
        draw([{ key: "name", label: "File name", type: "text" }]);
        await waitFor(() => expect(screen.getByText("Client pack")).toBeTruthy());

        expect(rowNamed("Client pack").textContent).not.toContain("Not ");
    });
});
