// @vitest-environment jsdom
/**
 * A field can pick a file the site already has.
 *
 * Every upload lands in the media library and the panel has a screen that
 * lists it - but the screen only listed. There was no way back out of it into
 * a field, so an operator who wanted last month's banner on a second page
 * uploaded it a second time. The library was a record of files rather than a
 * place to choose one from.
 *
 * The third way is only offered where the library is: it is an operator's
 * shelf, and `/api/v1/media` refuses anybody else. A field that posts
 * somewhere other than the library's own door - a member's avatar, for
 * instance - is not an operator's field and is not offered a shelf it would
 * be refused from.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
// next-intl's client navigation cannot be resolved under vitest's jsdom
// environment, and the pagination this pulls in reaches for it. Nothing here
// is a link, so a stub keeps the import graph loadable.
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
}));

const MESSAGES = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"),
);

const { UrlOrFile } = await import("@/core/components/ui/url-or-file");

function draw(props: { endpoint?: string } = {}) {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <UrlOrFile value="" onChange={() => {}} accept="image/*" label="Cover" {...props} />
        </NextIntlClientProvider>,
    );
}

describe("a field that holds a file", () => {
    it("offers the library beside the link and the upload", () => {
        draw();
        expect(screen.getByText(MESSAGES.common.mediaLibrary)).toBeTruthy();
    });

    it("offers no library where the caller is not an operator", () => {
        draw({ endpoint: "/api/v1/me/avatar" });
        expect(screen.queryByText(MESSAGES.common.mediaLibrary)).toBeNull();
    });
});

describe("the picker itself", () => {
    const source = fs.readFileSync(
        path.join(process.cwd(), "src/core/components/ui/media-picker.tsx"),
        "utf8",
    );

    it("reads the library rather than a list of its own", () => {
        expect(source).toContain("/api/v1/media");
        // Built with URLSearchParams rather than glued into the string, so
        // the assertion reads the parameter rather than the spelling.
        expect(source).toContain('type: "image"');
    });

    it("pages, because a library grows without bound", () => {
        expect(source).toMatch(/page: String\(page\)|perPage/);
    });

    it("is a dialog somebody can leave with the keyboard", () => {
        expect(source).toContain("useModalDialog");
        expect(source).toContain('role="dialog"');
    });

    it("says what went wrong instead of showing an empty shelf", () => {
        expect(source).toContain("LoadFailed");
    });
});
