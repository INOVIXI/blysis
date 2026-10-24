// @vitest-environment jsdom
/**
 * A block's words are in the reader's language.
 *
 * A theme writes its homepage in `theme.json`, and a heading it gives a block
 * there would be one language for every reader. So a text setting may name a
 * message instead: a value the site has a message for is shown translated,
 * and anything else, such as words an operator typed, is shown as written.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useBlockText } from "@/core/hooks/useBlockText";

const MESSAGES = { sample: { newsKicker: "Son gelişmeler", group: { nested: "İç içe" } } };

function Show({ value }: { value: unknown }) {
    const text = useBlockText();
    return <p data-testid="out">{text(value)}</p>;
}

function shown(value: unknown) {
    const { unmount } = render(
        <NextIntlClientProvider locale="tr" messages={MESSAGES} onError={() => {}}>
            <Show value={value} />
        </NextIntlClientProvider>,
    );
    const out = screen.getByTestId("out").textContent;
    unmount();
    return out;
}

describe("a block's text", () => {
    it("is the message a key names", () => {
        expect(shown("sample.newsKicker")).toBe("Son gelişmeler");
        expect(shown("sample.group.nested")).toBe("İç içe");
    });

    it("is what was written when no message has that name", () => {
        expect(shown("Cmt 20:00")).toBe("Cmt 20:00");
        expect(shown("Version 1.2 is out")).toBe("Version 1.2 is out");
        expect(shown("sample.missing")).toBe("sample.missing");
    });

    it("never prints a whole group of messages", () => {
        expect(shown("sample.group")).toBe("sample.group");
    });

    it("is nothing for a value that is not text", () => {
        expect(shown(undefined)).toBe("");
        expect(shown(42)).toBe("");
    });
});
