/**
 * The strip under the hero names who on the team is online, in the reader's
 * language, with the role each one holds.
 *
 * It said "2 staff online" in English on every site, and drew only faces:
 * a visitor could see that somebody was there but not who, or whether the
 * person to ask about a payment was among them. Where the strip sits is the
 * theme's business, so it brings no page margins of its own.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/staff/module.json"), "utf8"));
const { default: OnlineStaff } = await import("@/modules/staff/slots/OnlineStaff");

const members = { current: [] as unknown[] };

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ members: members.current }) })));
});

function draw(locale: string) {
    return render(
        <NextIntlClientProvider locale={locale} messages={MANIFEST.translations[locale]}>
            <OnlineStaff />
        </NextIntlClientProvider>,
    );
}

describe("the online staff strip", () => {
    it("says who is on the team right now, in Turkish on a Turkish page", async () => {
        members.current = [
            { id: "m1", name: "Ada", role: "Yönetici", user: { username: "ada", avatar: null } },
            { id: "m2", name: "Grace", role: "Moderatör", user: null },
        ];
        draw("tr");
        const list = await screen.findByRole("list", { name: MANIFEST.translations.tr.staff.onlineNow });
        expect(list.textContent).toContain("ada");
        expect(list.textContent).toContain("Yönetici");
        expect(list.textContent).toContain("Grace");
        expect(list.textContent).toContain("Moderatör");
        expect(document.body.textContent).not.toMatch(/staff online/i);
    });

    it("draws nothing while nobody is online", async () => {
        members.current = [];
        const { container } = draw("en");
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(container.innerHTML).toBe("");
    });

    it("leaves where it sits to the theme", async () => {
        members.current = [{ id: "m1", name: "Ada", role: "Admin", user: null }];
        const { container } = draw("en");
        await screen.findByRole("list");
        expect(container.innerHTML).not.toMatch(/\bcontainer\b|-mt-/);
    });

    it("ships its label in every locale the module speaks", () => {
        for (const [locale, catalogue] of Object.entries(MANIFEST.translations as Record<string, { staff: Record<string, string> }>)) {
            expect(catalogue.staff.onlineNow, locale).toBeTruthy();
        }
    });
});
