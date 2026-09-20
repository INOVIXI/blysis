// @vitest-environment jsdom
/**
 * A field holding several records shows their names, not their ids.
 *
 * `ReferencePicker` answers this for one record: nothing in the panel shows a
 * record's id, so a field that holds one offers the records instead. A field
 * that holds a list of them had no answer at all, which is why the only scope
 * anything could be given was a single product or a single category - one row
 * of the bulk-discount table per shelf, and for a coupon, whose code is
 * unique, no way to name a second product at all.
 *
 * The same rule holds for the list: what is chosen is drawn by name, with a
 * way to take each one back off.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {} }),
    usePathname: () => "/admin",
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const ROWS = [
    { id: "p1", name: "VIP Rank", slug: "vip-rank" },
    { id: "p2", name: "MVP Rank", slug: "mvp-rank" },
];

const asked: string[] = [];

beforeEach(() => {
    asked.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        asked.push(String(url));
        return new Response(JSON.stringify({ products: ROWS }), { status: 200 });
    }));
});

const { ReferenceList } = await import("@/core/components/admin/ReferenceList");

function draw(value: string[], onChange: (ids: string[]) => void) {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <ReferenceList
                value={value}
                onChange={onChange}
                label="Products"
                endpoint="/api/v1/store/admin/products"
                listKey="products"
                labelField="name"
                hintField="slug"
            />
        </NextIntlClientProvider>,
    );
}

describe("a field holding several records", () => {
    it("draws what is already chosen by name", async () => {
        draw(["p2"], () => {});
        expect(await screen.findByText("MVP Rank")).toBeTruthy();
        expect(screen.queryByText("p2")).toBeNull();
    });

    it("adds what was picked to what was there", async () => {
        const seen: string[][] = [];
        draw(["p2"], (ids) => seen.push(ids));
        fireEvent.focus(screen.getByRole("combobox", { name: /products/i }));
        fireEvent.click(await screen.findByText("VIP Rank"));
        await waitFor(() => expect(seen.at(-1)).toEqual(["p2", "p1"]));
    });

    it("takes one back off", async () => {
        const seen: string[][] = [];
        draw(["p1", "p2"], (ids) => seen.push(ids));
        const chip = await screen.findByText("VIP Rank");
        fireEvent.click(chip.closest("span")!.querySelector("button")!);
        await waitFor(() => expect(seen.at(-1)).toEqual(["p2"]));
    });

    it("never offers the same record twice", async () => {
        draw(["p1", "p2"], () => {});
        await screen.findByText("VIP Rank");
        fireEvent.focus(screen.getByRole("combobox", { name: /products/i }));
        // Both are already chosen, so the list under the box has nothing left.
        await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
    });
});
