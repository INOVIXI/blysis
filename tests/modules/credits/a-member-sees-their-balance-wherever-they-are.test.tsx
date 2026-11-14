// @vitest-environment jsdom
/**
 * A signed-in member sees their credit balance without opening their profile.
 *
 * The balance was drawn only inside the profile's credits section. It is now
 * in the site's bar, in the account menu and at the top of the shop, all from
 * one request. A visitor, or a member whose balance could not be read, sees
 * none of it.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({ signedIn: true }));

vi.mock("next-auth/react", () => ({
    useSession: () => ({ data: state.signedIn ? { user: { id: "u1" } } : null }),
}));
// The real request sharing, without the whole SDK barrel behind it.
vi.mock("@/core/sdk", async () => {
    const shared = await import("@/core/lib/shared-request");
    return { sharedJson: shared.sharedJson, invalidateShared: shared.invalidateShared };
});
vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ children, ...rest }: React.ComponentProps<"a">) => <a {...rest}>{children}</a>,
    usePathname: () => "/",
}));
vi.mock("@/core/sdk/ui", () => ({
    buttonClassName: () => "button",
}));

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/credits/module.json"), "utf8"));

const { CreditBalanceChip } = await import("@/modules/credits/components/CreditBalanceChip");
const { default: UserMenuBalance } = await import("@/modules/credits/slots/UserMenuBalance");
const { default: StoreBalanceStrip } = await import("@/modules/credits/slots/StoreBalanceStrip");
const { invalidateShared } = await import("@/core/lib/shared-request");

interface Answers {
    balance?: number;
    balanceStatus?: number;
}

function answer({ balance = 10, balanceStatus = 200 }: Answers = {}) {
    const fetchMock = vi.fn(async (url: string) => {
        if (url.startsWith("/api/v1/credits")) {
            return new Response(JSON.stringify({ balance }), { status: balanceStatus });
        }
        return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

function draw(node: React.ReactNode, locale: "en" | "tr" = "en") {
    return render(
        <NextIntlClientProvider locale={locale} messages={MANIFEST.translations[locale]}>
            {node}
        </NextIntlClientProvider>,
    );
}

beforeEach(() => {
    vi.unstubAllGlobals();
    // The shared answers live on `globalThis`, so one case would read the last one's.
    invalidateShared();
    state.signedIn = true;
});

describe("the balance in the bar", () => {
    it("names the amount and leads to the credits section", async () => {
        answer({ balance: 1234.5 });
        draw(<CreditBalanceChip />);

        const link = await screen.findByLabelText("Your credits: 1,234.50");
        expect(link.getAttribute("href")).toBe("/profile?section=credits");
        expect(link.textContent).toBe("1,234.50");
    });

    it("writes the number the reader's way", async () => {
        answer({ balance: 10 });
        draw(<CreditBalanceChip />, "tr");

        expect(await screen.findByLabelText("Krediniz: 10,00")).toBeTruthy();
    });

    it("draws nothing when the balance cannot be read", async () => {
        const fetchMock = answer({ balanceStatus: 500 });
        const { container } = draw(<CreditBalanceChip />);

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(container.innerHTML).toBe("");
    });

    it("draws nothing and asks nothing for a visitor", () => {
        state.signedIn = false;
        const fetchMock = answer();
        const { container } = draw(<CreditBalanceChip />);

        expect(container.innerHTML).toBe("");
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("the balance in the account menu", () => {
    it("leads to the credits section and closes the menu on a click", async () => {
        answer({ balance: 10 });
        const close = vi.fn();
        draw(<UserMenuBalance close={close} />);

        const row = await screen.findByText("Credits: 10.00");
        expect(row.closest("a")?.getAttribute("href")).toBe("/profile?section=credits");

        fireEvent.click(row);
        expect(close).toHaveBeenCalledTimes(1);
    });
});

describe("the balance at the top of the shop", () => {
    it("tells a member what they can spend", async () => {
        answer({ balance: 75 });
        draw(<StoreBalanceStrip />);

        expect(await screen.findByText("Your balance: 75.00 credits")).toBeTruthy();
    });

    it("is not there for a visitor", () => {
        state.signedIn = false;
        answer();
        const { container } = draw(<StoreBalanceStrip />);

        expect(container.innerHTML).toBe("");
    });
});

describe("one page", () => {
    it("asks for the balance once however many places show it", async () => {
        const fetchMock = answer({ balance: 5 });
        draw(
            <>
                <CreditBalanceChip />
                <UserMenuBalance />
                <StoreBalanceStrip />
            </>,
        );

        await screen.findByText("Your balance: 5.00 credits");
        const balanceCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/v1/credits"));
        expect(balanceCalls).toHaveLength(1);
    });
});

describe("the new words", () => {
    it("are in every locale the module ships", () => {
        const missing: string[] = [];
        for (const [locale, messages] of Object.entries(MANIFEST.translations as Record<string, { credits: Record<string, string> }>)) {
            for (const key of ["bal_ariaLabel", "bal_menu", "bal_store"]) {
                if (!messages.credits[key]?.includes("{amount}")) missing.push(`${locale}.${key}`);
            }
        }
        expect(missing).toEqual([]);
    });
});
