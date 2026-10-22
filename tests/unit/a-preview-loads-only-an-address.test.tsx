// @vitest-environment jsdom
/**
 * A file field previews an image only from an address a browser fetches.
 *
 * `FilePreview` put whatever the field held into an `img` whenever the field
 * asked for an image, and a pasted link is whatever somebody typed:
 * `javascript:` and `data:` went into `src` as they were. The preview now
 * draws a picture only for a path on this site or an http(s) address, and
 * anything else as the icon a field gets for an address that is not a
 * picture yet. CodeQL `js/xss-through-dom` (#78) flagged the `src`.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { FilePreview } from "@/core/components/ui/file-preview";

function previewOf(value: string) {
    const { container } = render(
        <NextIntlClientProvider locale="en" messages={{ common: { preview: "Preview" } }}>
            <FilePreview value={value} accept="image/*" />
        </NextIntlClientProvider>,
    );
    return container.querySelector("img")?.getAttribute("src") ?? null;
}

describe("the preview beside a file field", () => {
    it("draws an upload on this site", () => {
        expect(previewOf("/uploads/banner.png")).toBe("/uploads/banner.png");
    });

    it("draws an image at an https address", () => {
        expect(previewOf("https://cdn.example.com/banner.png")).toBe("https://cdn.example.com/banner.png");
    });

    it("does not load a script address", () => {
        expect(previewOf("javascript:alert(document.cookie)")).toBeNull();
    });

    it("does not load inline data somebody pasted", () => {
        expect(previewOf("data:text/html,<script>alert(1)</script>")).toBeNull();
    });
});
