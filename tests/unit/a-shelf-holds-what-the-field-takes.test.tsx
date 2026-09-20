// @vitest-environment jsdom
/**
 * The library a field opens holds the kind of file that field takes.
 *
 * Every upload lands in the media library and the endpoint that receives it
 * accepts a ZIP, a PDF and a JSON file as readily as a picture. The picker a
 * field opens asked for `type=image` and nothing else, so the shelf offered
 * to the downloads module's file field - the one whose entire job is to point
 * at an archive somebody can download - could never contain an archive. An
 * operator who had already uploaded `modpack.zip` had to upload it again
 * through the field, and the library filled with second copies, which is the
 * duplication the picker was written to stop.
 *
 * A field that takes a picture still sees pictures only: a shelf of things
 * that cannot be chosen is worse than a shorter shelf. What changed is that
 * the shelf now reads the field instead of assuming.
 *
 * The same mistake was in the preview the field draws beside what it holds:
 * an archive got the picture icon, which says the field wanted something
 * else and got this.
 *
 * The pager was reading the wrong place, too. `/api/v1/media` answers with
 * `totalPages` at the top of the body and the picker looked for it under a
 * `pagination` object that endpoint has never sent, so `?? 1` held: a library
 * of two hundred images showed the newest twenty-four and no way to the rest.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
// `Pagination` reads the live query string even in its button form, so a
// bare jsdom render of anything that can page needs the router stubbed.
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/admin/downloads",
    useSearchParams: () => new URLSearchParams(),
}));

const { UrlOrFile } = await import("@/core/components/ui/url-or-file");

const messages = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const asked: string[] = [];
let body: unknown = { items: [], total: 0, page: 1, perPage: 24, totalPages: 1 };

beforeEach(() => {
    asked.length = 0;
    body = { items: [], total: 0, page: 1, perPage: 24, totalPages: 1 };
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            asked.push(String(url));
            return new Response(JSON.stringify(body), { status: 200 });
        }),
    );
});

function draw(accept?: string) {
    return render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <UrlOrFile value="" onChange={() => {}} accept={accept} />
        </NextIntlClientProvider>,
    );
}

async function openTheShelf(accept?: string) {
    draw(accept);
    fireEvent.click(screen.getByRole("button", { name: /media library/i }));
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    return asked.at(-1) as string;
}

describe("the shelf a field opens", () => {
    it("offers every file where the field takes any file", async () => {
        expect(await openTheShelf(undefined)).not.toContain("type=image");
    });

    it("offers only pictures where the field takes a picture", async () => {
        expect(await openTheShelf("image/*")).toContain("type=image");
    });

    it("offers every file where the field asks for an archive", async () => {
        expect(await openTheShelf(".zip,application/zip")).not.toContain("type=image");
    });
});

describe("a file that is not a picture", () => {
    it("is drawn as the file it is, not as a picture that will not load", async () => {
        body = {
            items: [{ id: "1", filename: "modpack.zip", url: "/uploads/modpack.zip", mimeType: "application/zip" }],
            total: 1, page: 1, perPage: 24, totalPages: 1,
        };
        await openTheShelf(undefined);
        expect(await screen.findByText("modpack.zip")).toBeTruthy();
        // An <img> pointed at an archive draws the browser's broken-image mark.
        expect(document.querySelectorAll('img[src="/uploads/modpack.zip"]').length).toBe(0);
    });
});

describe("a library bigger than one screenful", () => {
    it("can be paged, because the endpoint says how many pages there are", async () => {
        body = {
            items: [{ id: "1", filename: "a.png", url: "/uploads/a.png", mimeType: "image/png" }],
            total: 60, page: 1, perPage: 24, totalPages: 3,
        };
        await openTheShelf("image/*");
        expect(await screen.findByRole("button", { name: /page 2 of 3/i })).toBeTruthy();
    });
});

describe("a field holding an archive", () => {
    it("draws it as a file, not as a picture it is waiting for", () => {
        render(
            <NextIntlClientProvider locale="en" messages={messages}>
                <UrlOrFile value="https://example.com/modpack.zip" onChange={() => {}} />
            </NextIntlClientProvider>,
        );
        expect(document.querySelector("svg.lucide-file")).toBeTruthy();
        expect(document.querySelector("svg.lucide-image")).toBeNull();
    });
});
