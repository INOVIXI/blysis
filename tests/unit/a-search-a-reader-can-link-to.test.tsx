// @vitest-environment jsdom
/**
 * A list the server narrows is searched in the address.
 *
 * Two kinds of list live in this panel. One has every row in the browser
 * already and is searched there, which is what `useRowList` is for. The other
 * is paged by the server because it can hold a hundred thousand rows - users,
 * the audit log, the activity log - and searching the fifty rows that
 * happened to arrive would answer the wrong question: an operator looking for
 * a member would be told there is no such person because they are on page
 * nine hundred.
 *
 * Those lists search in the query, so the term rides in the address. That
 * makes the result a thing somebody can bookmark, reload and send to a
 * colleague, and it is what `Pagination` already does with the page number -
 * one component, two modes, rather than two components.
 *
 * The term has to take the page with it. A search run from page nine that
 * matches two rows has no page nine to show, and the reader gets an empty
 * table with a full count above it.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const pushed: string[] = [];

/**
 * A router that actually moves. Reading the address back is half of what is
 * being tested - the box has to show what the address says - and a mock that
 * swallowed the push would have the component typing into a void.
 */
let address = "page=9&role=admin";

vi.mock("@/core/lib/i18n/navigation", () => ({
    useRouter: () => ({
        push: (href: string) => {
            pushed.push(href);
            address = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
        },
        replace: (href: string) => pushed.push(href),
    }),
    usePathname: () => "/admin/users",
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(address),
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const { ListControls } = await import("@/core/components/ui/list-controls");

beforeEach(() => {
    pushed.length = 0;
    address = "page=9&role=admin";
});

function draw() {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <ListControls search={{ param: "q" }} />
        </NextIntlClientProvider>,
    );
}

describe("a search backed by the address", () => {
    it("draws a box", () => {
        draw();
        expect(screen.getByRole("searchbox")).toBeTruthy();
    });

    it("puts what was typed into the address", async () => {
        draw();
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "aeryn" } });
        await waitFor(() => expect(pushed.length).toBeGreaterThan(0));
        expect(pushed.at(-1)).toContain("q=aeryn");
    });

    it("takes the reader back to the first page", async () => {
        draw();
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "aeryn" } });
        await waitFor(() => expect(pushed.length).toBeGreaterThan(0));
        expect(pushed.at(-1)).not.toContain("page=");
    });

    it("leaves every other parameter where it was", async () => {
        draw();
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "aeryn" } });
        await waitFor(() => expect(pushed.length).toBeGreaterThan(0));
        expect(pushed.at(-1)).toContain("role=admin");
    });

    it("drops the parameter when the box is emptied, rather than leaving q=", async () => {
        // `?q=` and no parameter are the same screen, and only one of them
        // should be linkable.
        address = "q=aeryn&role=admin";
        render(
            <NextIntlClientProvider locale="en" messages={MESSAGES}>
                <ListControls search={{ param: "q" }} />
            </NextIntlClientProvider>,
        );
        expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("aeryn");

        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
        await waitFor(() => expect(pushed.length).toBe(1));
        expect(pushed.at(-1)).not.toContain("q=");
        expect(pushed.at(-1)).toContain("role=admin");
    });

    it("starts with whatever the address already says", () => {
        render(
            <NextIntlClientProvider locale="en" messages={MESSAGES}>
                <ListControls search={{ param: "role" }} />
            </NextIntlClientProvider>,
        );
        expect((screen.getAllByRole("searchbox")[0] as HTMLInputElement).value).toBe("admin");
    });
});
