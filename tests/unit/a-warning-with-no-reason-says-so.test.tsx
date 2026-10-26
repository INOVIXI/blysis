/**
 * A warning given no reason says so, in the reader's language.
 *
 * A warning can arrive without a reason: a module that issues one from a
 * punishment passes on whatever the moderator typed, which may be nothing.
 * The screen printed the column as it was, so such a row had an empty line
 * where its reason goes, or whatever placeholder the writer had put in the
 * database in its own language. The words belong to the screen.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
    usePathname: () => "/admin/warnings",
}));
vi.mock("@/core/components/ui/confirm-dialog", () => ({ useConfirm: () => ({ confirm: async () => false }) }));
vi.mock("@/core/hooks/useLocalDate", () => ({
    useLocalDate: () => () => "23.10.2026",
    useLocalDateTime: () => () => "23.10.2026 21:00",
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/tr.json"), "utf8"));

function warning(reason: string) {
    return {
        id: `w-${reason || "none"}`,
        reason,
        points: 1,
        expiresAt: null,
        isActive: true,
        createdAt: "2026-10-23T18:00:00.000Z",
        user: { id: "u1", username: "steve" },
        issuedBy: null,
    };
}

describe("a warning with no reason", () => {
    it("says none was given, and keeps a reason that was", async () => {
        vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
            warnings: [warning(""), warning("griefing the spawn")],
            pages: 1,
            total: 2,
        })));
        const { default: WarningsPage } = await import("@/app/[locale]/(admin)/admin/warnings/page");

        render(
            <NextIntlClientProvider locale="tr" messages={MESSAGES} timeZone="UTC">
                <WarningsPage />
            </NextIntlClientProvider>,
        );

        expect(await screen.findByText(MESSAGES.admin.warnings_noReason)).toBeTruthy();
        expect(screen.getByText("griefing the spawn")).toBeTruthy();
        vi.unstubAllGlobals();
    });
});
