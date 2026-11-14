// @vitest-environment jsdom
/**
 * A text setting can offer values without limiting the answer to them.
 *
 * An AI provider's model is a free string: the vendor ships new ones every
 * month, and an operator must be able to type one this build has never heard
 * of. But when the screen has just read the vendor's own list, typing from
 * memory is how a model id gets misspelt. A field given `suggestions` offers
 * them and still takes anything.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/admin/settings/provider",
}));
vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ settings: { model_fast: "stored-model" } }), { status: 200 })));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));
const { SettingsForm } = await import("@/core/components/admin/SettingsForm");

function wrap(node: React.ReactNode) {
    return render(<NextIntlClientProvider locale="en" messages={MESSAGES}>{node}</NextIntlClientProvider>);
}

describe("a text setting with suggestions", () => {
    it("offers each suggestion and keeps what was typed", async () => {
        wrap(
            <SettingsForm
                title="Provider"
                subtitle=""
                fields={[{ key: "model_fast", label: "Fast model", suggestions: ["model-a", "model-b"] }]}
            />,
        );
        const input = (await screen.findByRole("combobox", { name: "Fast model" })) as HTMLInputElement;
        expect(input.value).toBe("stored-model");
        const list = document.getElementById(input.getAttribute("list") ?? "");
        expect(list?.tagName).toBe("DATALIST");
        expect(Array.from(list!.querySelectorAll("option")).map((o) => o.getAttribute("value"))).toEqual(["model-a", "model-b"]);
        fireEvent.change(input, { target: { value: "a-model-nobody-listed" } });
        expect(input.value).toBe("a-model-nobody-listed");
    });

    it("is a plain text box when there is nothing to suggest", async () => {
        wrap(<SettingsForm title="Provider" subtitle="" fields={[{ key: "model_fast", label: "Fast model" }]} />);
        const input = await screen.findByRole("textbox", { name: "Fast model" });
        expect(input.getAttribute("list")).toBeNull();
    });
});
