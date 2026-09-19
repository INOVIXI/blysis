// @vitest-environment jsdom
/**
 * A stored choice is shown to a reader by its name.
 *
 * The announcements list printed `info` under every row's title, and the
 * wheel prizes list did the same with its kind. Both name a `select` field in
 * `secondaryField`, and the shell rendered `item[field]` - which is the value
 * the database holds, not the label the same screen offers in the form one
 * click away. An operator therefore picks "Info (Blue)" and is shown `info`.
 *
 * The screen already declares what each value is called. Nothing has to be
 * added to it; the list only has to read what the form reads.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/admin/announcements",
    useSearchParams: () => new URLSearchParams(""),
}));
vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ announcements: [{ id: "1", title: "Season 4 starts Friday", type: "info" }] }),
    { status: 200 },
)));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const { AdminCrudPage } = await import("@/core/components/admin/AdminCrudPage");

function draw() {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <AdminCrudPage
                title="Announcements"
                subtitle="Site-wide banners"
                apiPath="/api/v1/announcements"
                listKey="announcements"
                displayField="title"
                secondaryField="type"
                fields={[
                    { key: "title", label: "Title", required: true },
                    { key: "type", label: "Type", type: "select", options: [
                        { value: "info", label: "Info (Blue)" },
                        { value: "warning", label: "Warning (Yellow)" },
                    ], defaultValue: "info" },
                ]}
            />
        </NextIntlClientProvider>,
    );
}

describe("a row's second line", () => {
    it("says what the choice is called", async () => {
        draw();
        expect(await screen.findByText("Info (Blue)")).toBeTruthy();
    });

    it("does not say the value the column holds", async () => {
        draw();
        await screen.findByText("Season 4 starts Friday");
        expect(screen.queryByText("info")).toBeNull();
    });

    it("still shows a plain field's value as it is", async () => {
        // A free text column has no names to choose between, and blanking it
        // because no option matched would lose the line entirely.
        render(
            <NextIntlClientProvider locale="en" messages={MESSAGES}>
                <AdminCrudPage
                    title="Staff" subtitle="" apiPath="/api/v1/staff" listKey="announcements"
                    displayField="title" secondaryField="type"
                    fields={[{ key: "title", label: "Title" }, { key: "type", label: "Role" }]}
                />
            </NextIntlClientProvider>,
        );
        expect(await screen.findByText("info")).toBeTruthy();
    });
});
