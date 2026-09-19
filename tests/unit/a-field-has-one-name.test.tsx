// @vitest-environment jsdom
/**
 * A field is named once, and its control sits where the one beside it does.
 *
 * Every screen built on `AdminCrudPage` lays its fields out in two columns:
 * a label, then the control under it. A boolean got both halves and then a
 * name of its own as well, so the download editor read "Active" over a box
 * reading "Enabled" - two names for one answer, and neither of them the one
 * an operator would ask for.
 *
 * The second half is what it looked like. A checkbox is eighteen pixels tall
 * and an input is forty, so the right-hand cell held a label and a sliver
 * while the left held a label and a field, and the row read as misaligned
 * because it was. Nothing in the source says so: both cells are a label and
 * a control.
 *
 * So a toggle is its own label, and it is drawn in a box the height of an
 * input, aligned to the bottom of its cell - which is where the input beside
 * it ends.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
// `useFormRoute` reads the query from next/navigation and the path from the
// locale-aware one, so both have to answer here or the screen shows its list.
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams("form=new"),
}));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/admin/downloads",
    useSearchParams: () => new URLSearchParams("form=new"),
}));
vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const { AdminCrudPage } = await import("@/core/components/admin/AdminCrudPage");

function draw() {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <AdminCrudPage
                title="Downloads"
                subtitle="Files this site offers"
                apiPath="/api/v1/downloads"
                listKey="items"
                displayField="name"
                fields={[
                    { key: "name", label: "File name", type: "text", required: true },
                    { key: "isActive", label: "Active", type: "toggle" },
                ]}
            />
        </NextIntlClientProvider>,
    );
}

describe("a boolean field", () => {
    it("is named by the field, not by a word of the control's own", async () => {
        draw();
        expect(await screen.findByRole("checkbox", { name: "Active" })).toBeTruthy();
    });

    it("carries that name once", async () => {
        const { container } = draw();
        await screen.findByRole("checkbox", { name: "Active" });
        const named = [...container.querySelectorAll("label")].filter(
            (l) => (l.textContent ?? "").trim() === "Active",
        );
        expect(named).toHaveLength(1);
    });

    it("stands as tall as the control it sits beside, and at the same height", async () => {
        // jsdom has no layout, so the agreement is read off the box the
        // toggle is drawn in: an input's height, pushed to the foot of the
        // cell, which is where the input in the cell beside it ends.
        const { container } = draw();
        await screen.findByRole("checkbox", { name: "Active" });
        const box = container.querySelector("[data-field='isActive']") as HTMLElement;
        expect(box).toBeTruthy();
        expect(box.className).toContain("justify-end");
        expect(box.querySelector(".h-10")).toBeTruthy();
    });
});
