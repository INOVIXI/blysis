// @vitest-environment jsdom
/**
 * A field that holds an image shows the image, however it got there.
 *
 * `UrlOrFile` offers two ways to fill one field and drew them as two
 * different controls: picking a file rendered `FileUpload`, which previews
 * what it holds and offers to replace or remove it, while pasting a link
 * rendered a bare text box. So the same value - the same image, at the same
 * address - was visible in one mode and invisible in the other, and an
 * operator who pasted a wrong URL found out when the page shipped.
 *
 * The preview is the field's, not the picker's.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
// next-intl's client navigation cannot be resolved under vitest's jsdom
// environment, and the library picker this field offers reaches for it.
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

function draw(value: string) {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <UrlOrFile value={value} onChange={() => {}} accept="image/*" label="Cover" />
        </NextIntlClientProvider>,
    );
}

describe("a field that takes a link or a file", () => {
    it("previews an address somebody pasted", () => {
        const { container } = draw("https://example.test/cover.png");
        const image = container.querySelector("img");
        expect(image, "a pasted image is still an image").not.toBeNull();
        expect(image?.getAttribute("src")).toBe("https://example.test/cover.png");
    });

    it("previews a file somebody uploaded", () => {
        const { container } = draw("/uploads/2026/cover.png");
        expect(container.querySelector("img")?.getAttribute("src")).toBe("/uploads/2026/cover.png");
    });

    it("offers a way to take back either one", () => {
        draw("https://example.test/cover.png");
        expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    });

    it("shows no preview when the field is empty", () => {
        const { container } = draw("");
        expect(container.querySelector("img")).toBeNull();
    });
});
