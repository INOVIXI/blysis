/**
 * The moderation screen shows the list of the view it is on.
 *
 * Every change of view, and every decision, asks for the list again, and the
 * answers can come back in any order. The screen kept whichever answer came
 * last, so a moderator who left the queue for the Rejected view before the
 * queue had answered saw the queue's items under the Rejected tab. The e2e
 * spec a-rejection-says-why-and-can-be-taken-back caught it the other way
 * round: the Rejected list landing under Waiting after "Back to queue".
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
    usePathname: () => "/admin/moderation",
}));
vi.mock("@/core/hooks/useLocalDate", () => ({
    useLocalDate: () => () => "23.11.2026",
    useLocalDateTime: () => () => "23.11.2026 12:00",
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));
const KIND = "forum-topic";

function row(id: string, title: string) {
    return { id, type: KIND, author: null, preview: title, title, createdAt: "2026-11-23T10:00:00.000Z" };
}

function json(body: unknown) {
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("the moderation screen", () => {
    it("keeps the Rejected list when the queue answers after it", async () => {
        let answerQueue: (() => void) | null = null;
        vi.stubGlobal("fetch", (input: string) => {
            const url = new URL(input, "http://localhost");
            if (!url.searchParams.has("type")) {
                return Promise.resolve(json({ counts: { [KIND]: 1 }, types: { [KIND]: { label: "Topic", canListRejected: true } } }));
            }
            if (url.searchParams.get("state") === "rejected") {
                return Promise.resolve(json({ items: [row("r1", "Turned down")], total: 1, page: 1, pages: 1 }));
            }
            return new Promise<Response>((resolve) => {
                answerQueue = () => resolve(json({ items: [row("p1", "Still waiting")], total: 1, page: 1, pages: 1 }));
            });
        });
        const { default: ModerationPage } = await import("@/app/[locale]/(admin)/admin/moderation/page");

        render(
            <NextIntlClientProvider locale="en" messages={MESSAGES} timeZone="UTC">
                <ModerationPage />
            </NextIntlClientProvider>,
        );

        fireEvent.click(await screen.findByRole("tab", { name: MESSAGES.admin.moderation_viewRejected }));
        expect(await screen.findByText("Turned down")).toBeTruthy();
        expect(answerQueue, "the queue was asked for and has not answered").not.toBeNull();

        await act(async () => {
            answerQueue!();
            await new Promise((settle) => setTimeout(settle, 0));
        });

        expect(screen.queryByText("Still waiting")).toBeNull();
        expect(screen.getByText("Turned down")).toBeTruthy();
    });
});
