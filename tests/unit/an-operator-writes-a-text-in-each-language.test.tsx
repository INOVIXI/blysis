/**
 * The box an admin types the site's own words into offers a translation for
 * every language the site speaks, and says which of them are filled.
 *
 * Everything an operator typed had one value, shown in every language. The
 * input keeps the original text in front, where the admin has always typed
 * it, and opens the site's languages beneath it on request. A value with no
 * translation left is handed back as the plain string it then is.
 */
import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/hooks/useSiteSettings", () => ({
    useSiteSettings: () => ({ settings: { site_languages: ["tr", "en", "de"], default_locale: "tr" }, loaded: true }),
}));

const { LocalizedTextInput } = await import("@/core/components/ui/localized-text-input");
const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

function Harness({ initial, seen }: { initial: unknown; seen: (v: unknown) => void }) {
    const [value, setValue] = useState(initial);
    return (
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <LocalizedTextInput
                label="Site name"
                value={value as string}
                onChange={(next) => { setValue(next); seen(next); }}
            />
        </NextIntlClientProvider>
    );
}

describe("LocalizedTextInput", () => {
    it("shows the original text and keeps the languages closed until asked", () => {
        render(<Harness initial={{ default: "Vanilya", en: "Vanilla" }} seen={() => {}} />);
        expect((screen.getByRole("textbox", { name: "Site name" }) as HTMLInputElement).value).toBe("Vanilya");
        const toggle = screen.getByRole("button", { name: /1 of 3/ });
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(screen.queryByRole("textbox", { name: /English/ })).toBeNull();
    });

    it("offers every language the site speaks, each named, and marks the filled ones", () => {
        render(<Harness initial={{ default: "Vanilya", en: "Vanilla" }} seen={() => {}} />);
        fireEvent.click(screen.getByRole("button", { name: /1 of 3/ }));
        expect((screen.getByRole("textbox", { name: "Site name, English" }) as HTMLInputElement).value).toBe("Vanilla");
        expect(screen.getByRole("textbox", { name: "Site name, Deutsch" })).toBeTruthy();
        expect(screen.getByRole("textbox", { name: "Site name, Türkçe" })).toBeTruthy();
        expect(screen.getByText("English").parentElement?.textContent).toContain("Translated");
        expect(screen.getByText("Deutsch").parentElement?.textContent).toContain("Shows the original");
    });

    it("hands back a translation beside the original", () => {
        const seen = vi.fn();
        render(<Harness initial="Vanilya" seen={seen} />);
        fireEvent.click(screen.getByRole("button", { name: /0 of 3/ }));
        fireEvent.change(screen.getByRole("textbox", { name: "Site name, Deutsch" }), { target: { value: "Vanille" } });
        expect(seen).toHaveBeenLastCalledWith({ default: "Vanilya", de: "Vanille" });
    });

    it("hands back a plain string once the last translation is cleared", () => {
        const seen = vi.fn();
        render(<Harness initial={{ default: "Vanilya", en: "Vanilla" }} seen={seen} />);
        fireEvent.click(screen.getByRole("button", { name: /1 of 3/ }));
        fireEvent.change(screen.getByRole("textbox", { name: "Site name, English" }), { target: { value: "" } });
        expect(seen).toHaveBeenLastCalledWith("Vanilya");
    });

    it("keeps the translations when the original changes", () => {
        const seen = vi.fn();
        render(<Harness initial={{ default: "Vanilya", en: "Vanilla" }} seen={seen} />);
        fireEvent.change(screen.getByRole("textbox", { name: "Site name" }), { target: { value: "Vanilya MC" } });
        expect(seen).toHaveBeenLastCalledWith({ default: "Vanilya MC", en: "Vanilla" });
    });

    it("draws a multi-line box when asked", () => {
        render(
            <NextIntlClientProvider locale="en" messages={MESSAGES}>
                <LocalizedTextInput label="About" value="x" onChange={() => {}} multiline />
            </NextIntlClientProvider>,
        );
        expect(screen.getByRole("textbox", { name: "About" }).tagName).toBe("TEXTAREA");
    });
});
