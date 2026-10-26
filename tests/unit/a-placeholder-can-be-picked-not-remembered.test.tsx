/**
 * An operator picks a site placeholder; they do not have to remember it.
 *
 * A text the theme marked for placeholders has a control beside it that lists
 * what this site answers, in the panel's language, with each one's value now,
 * and puts the token where the caret is. A token in the text that nothing on
 * this site answers is named under the field, because the visitor would see
 * only a dash and the operator would never learn why.
 */
import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/lib/shared-request", () => ({
    sharedJson: async () => ({
        placeholders: [
            { name: "site.name", module: "core", labelKey: "placeholder_site_name", example: null, value: "Kayadibi" },
            { name: "servers.online", module: "servers", labelKey: "placeholder_servers_online", example: "214", value: null },
        ],
    }),
}));

const { TextField } = await import("@/core/components/admin/theme-customizer/fields/TextField");

const TR = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/tr.json"), "utf8"));
const messages = { ...TR, admin: { ...TR.admin, placeholder_servers_online: "Çevrimiçi oyuncu sayısı" } };

function Field({ initial, placeholders = true }: { initial: string; placeholders?: boolean }) {
    const [value, setValue] = useState<string | undefined>(initial);
    return (
        <NextIntlClientProvider locale="tr" messages={messages}>
            <TextField
                def={{ type: "text", label: "Başlık", ...(placeholders ? { placeholders: true as const } : {}) }}
                value={value}
                onChange={setValue}
                isDefault={false}
            />
            <output data-testid="value">{value}</output>
        </NextIntlClientProvider>
    );
}

describe("a text that takes placeholders", () => {
    it("lists what this site answers and puts the one picked where the caret is", async () => {
        render(<Field initial="Şu an  kişi" />);
        const input = screen.getByLabelText("Başlık") as HTMLInputElement;
        input.setSelectionRange(6, 6);
        fireEvent.click(screen.getByRole("button", { name: TR.admin.placeholder_insert }));
        const pick = await screen.findByRole("button", { name: /Çevrimiçi oyuncu sayısı/ });
        expect(pick.textContent).toContain(TR.admin.placeholder_noValue);
        expect(screen.getByRole("button", { name: /Site adı|Kayadibi/ }).textContent).toContain("Kayadibi");
        fireEvent.click(pick);
        expect(screen.getByTestId("value").textContent).toBe("Şu an {servers.online} kişi");
    });

    it("names a token nothing on this site answers", async () => {
        render(<Field initial="{vote.total} oy, {servers.online} kişi" />);
        const warning = await waitFor(() => screen.getByText(/\{vote\.total\}/, { selector: "p" }));
        expect(warning.textContent).not.toContain("servers.online");
    });

    it("offers nothing where the theme did not mark the text", () => {
        render(<Field initial="discord.gg/kayadibi" placeholders={false} />);
        expect(screen.queryByRole("button", { name: TR.admin.placeholder_insert })).toBeNull();
    });
});
