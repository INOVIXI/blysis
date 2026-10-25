/**
 * The activity feed speaks the language of the page it is on.
 *
 * Its empty state was an English sentence written as a default argument, so
 * the public feed and the homepage's section told a Turkish visitor "No
 * recent activity yet." on an otherwise Turkish page, and every entry's age
 * was formatted by date-fns with no locale: "3 hours ago" under a Turkish
 * title.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const { ActivityFeedList } = await import("@/core/components/activity/ActivityFeedList");

const TR = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/tr.json"), "utf8"));

function draw(items: Parameters<typeof ActivityFeedList>[0]["items"]) {
    return render(
        <NextIntlClientProvider locale="tr" messages={TR}>
            <ActivityFeedList items={items} moduleStates={{}} />
        </NextIntlClientProvider>,
    );
}

describe("the activity feed", () => {
    it("says it is empty in the reader's language", () => {
        draw([]);
        expect(screen.getByText(TR.profile.noRecentActivity)).toBeTruthy();
        expect(screen.queryByText(/No recent activity/)).toBeNull();
    });

    it("says how long ago something happened in the reader's language", () => {
        const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
        const { container } = draw([{
            id: "a1", type: "custom", title: "Hello", body: null, href: null, icon: null,
            isPublic: true, createdAt: threeHoursAgo.toISOString(), actor: null,
        }]);
        expect(container.textContent).toContain("3 saat önce");
        expect(container.textContent).not.toMatch(/ago/);
    });
});
