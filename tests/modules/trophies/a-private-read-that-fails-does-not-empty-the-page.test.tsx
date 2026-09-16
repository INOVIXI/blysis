/**
 * The page the server wrote survives an answer only the reader is owed.
 *
 * The trophy list moved to the server, but the screen still asks the API
 * which of them this reader has earned - that answer is one person's and
 * cannot be written into a page anyone else may be served. The screen had
 * kept the shape it had when that one fetch carried everything: a failure
 * replaced the whole page, so a flaky personal read blanked a list that was
 * already in the HTML. And nothing ever lowered the flag, so a retry that
 * worked changed nothing on screen.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1" } } }) }));
// next-intl's client navigation cannot be resolved under vitest's jsdom
// environment. Nothing on this screen is a link, so a stub keeps the import
// graph loadable without standing in for anything the test asserts.
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/",
    redirect: () => {},
}));
vi.mock("@/core/sdk/layout", () => ({
    PageFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { TrophyGrid } = await import("@/../module-sources/trophies/components/TrophyGrid");

const MESSAGES = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"),
);
const MANIFEST = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "module-sources/trophies/module.json"), "utf8"),
);
const messages = { ...MESSAGES, trophies: MANIFEST.translations.en.trophies };

const TROPHIES = [
    { id: "t1", name: "First light", description: null, icon: null, color: null, points: 10, _count: { users: 3 } },
];

function draw() {
    return render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <TrophyGrid initial={TROPHIES} />
        </NextIntlClientProvider>,
    );
}

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe("a trophy page whose personal read fails", () => {
    it("still shows the trophies the server sent", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
        draw();
        await screen.findByRole("alert");
        expect(screen.getByText("First light")).toBeTruthy();
    });

    it("takes the failure down once a retry works", async () => {
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValue({ ok: true, json: async () => ({ earned: [] }) });
        vi.stubGlobal("fetch", fetchMock);
        draw();
        const alert = await screen.findByRole("alert");
        (alert.querySelector("button") as HTMLButtonElement).click();
        await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });
});
