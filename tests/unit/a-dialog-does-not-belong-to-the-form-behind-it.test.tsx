// @vitest-environment jsdom
/**
 * A dialog opened from inside a form is not part of that form.
 *
 * Every admin screen that edits a row puts the whole screen in one `<form>`,
 * and a field inside it opens the media library. The library drew itself
 * where it stood, so its markup landed inside that form: the search box was
 * a `<form>` inside a `<form>`, which is invalid HTML, and React said so on
 * every download and every other screen with an image field.
 *
 * The nesting is the visible half. The other half is that every button in a
 * dialog inside a form is a submit button unless it says otherwise, because
 * that is what a `<button>` with no type is. Closing the picker would save
 * the row behind it.
 *
 * So the dialog is rendered into the body instead. That is the only way it
 * stops being a descendant of whatever opened it, and it is also what makes
 * a modal behave like one - no ancestor's `overflow` can clip it and no
 * ancestor's stacking context can bury it.
 *
 * React's own events still travel the React tree rather than the DOM, so a
 * submit inside the portal would reach the form's `onSubmit` anyway. The
 * search is not a form at all now; it is a box and a button.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const { MediaPicker } = await import("@/core/components/ui/media-picker");

function openInsideAForm() {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <form onSubmit={(e) => e.preventDefault()}>
                <MediaPicker onPick={() => {}} onClose={() => {}} />
            </form>
        </NextIntlClientProvider>,
    );
}

describe("the media library opened from a form", () => {
    it("puts no form inside the form", () => {
        openInsideAForm();
        expect(document.querySelectorAll("form form")).toHaveLength(0);
    });

    it("leaves the form's own subtree, so nothing it draws belongs to the form", () => {
        const { container } = openInsideAForm();
        const outer = container.querySelector("form") as HTMLFormElement;
        expect(outer).toBeTruthy();
        expect(outer.querySelector('[role="dialog"]')).toBeNull();
        expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });

    it("gives every button it draws a type, so none of them is a submit", () => {
        openInsideAForm();
        const untyped = [...document.querySelectorAll('[role="dialog"] button')]
            .filter((b) => (b as HTMLButtonElement).getAttribute("type") !== "button")
            .map((b) => (b.textContent ?? "").trim() || (b.getAttribute("aria-label") ?? "?"));
        expect(untyped).toEqual([]);
    });
});

describe("the overlays a form can contain", () => {
    /**
     * Read off the source rather than rendered, because the next one written
     * is the one that forgets, and each of these needs its own fixtures to
     * mount. A modal that draws itself where it stands is the shape being
     * kept out.
     */
    const OVERLAYS = [
        "src/core/components/ui/media-picker.tsx",
        "src/core/components/ui/icon-picker.tsx",
        "src/core/components/ui/confirm-dialog.tsx",
        "src/core/components/ui/image-lightbox.tsx",
    ];

    it.each(OVERLAYS)("%s renders into the body", (file) => {
        const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
        expect(source).toContain("ModalLayer");
    });
});
