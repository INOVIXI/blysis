// @vitest-environment jsdom
/**
 * A count drawn on the corner of an icon is in the control's name too.
 *
 * `CountBadge` marks the bell and the cart with a number, and it is
 * `aria-hidden`: a bare "3" read out next to "Cart" is a puzzle rather than a
 * fact, and the digits are a duplicate of something the control can say
 * properly. That is the right call for the badge and the wrong place to stop.
 * Both call sites named their control "Cart" and "Notifications" and nothing
 * else, so somebody listening to the page was told the cart exists and never
 * that anything was in it.
 *
 * Each call site ships two strings, because the sentence differs when the
 * number is zero and a control named "Cart, 0 items" is worse than one named
 * "Cart". The manifest carries both in both locales.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1" } } }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/" }));
vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ children, ...rest }: React.ComponentProps<"a">) => <a {...rest}>{children}</a>,
}));
// `MemberLink` reaches the locale-aware router through here, and next-intl
// builds that at import time against `next/navigation`, which jsdom has not.
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children, ...rest }: React.ComponentProps<"a">) => <a {...rest}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
}));

const manifest = (id: string) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, "module-sources", id, "module.json"), "utf8"));

const STORE = manifest("store");
const BELL = manifest("in-app-notifications");

const { CartIcon } = await import("@/modules/store/components/CartIcon");

function drawCart(count: number, locale: "en" | "tr") {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ itemCount: count }), { status: 200 })));
    return render(
        <NextIntlClientProvider locale={locale} messages={STORE.translations[locale]}>
            <CartIcon />
        </NextIntlClientProvider>,
    );
}

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe("the cart icon", () => {
    it("says how much is in it, so a number nobody can see is still heard", async () => {
        drawCart(3, "en");

        await waitFor(() => expect(screen.getByLabelText("Cart, 3 items")).toBeTruthy());
    });

    it("says only what it is when it is empty", async () => {
        drawCart(0, "en");

        await waitFor(() => expect(screen.getByLabelText("Cart")).toBeTruthy());
    });

    it("says it in the reader's own language", async () => {
        drawCart(3, "tr");

        await waitFor(() => expect(screen.getByLabelText("Sepet, 3 ürün")).toBeTruthy());
    });
});

describe("both counted names", () => {
    it("are declared in both locales, so neither falls back to a key", () => {
        const missing: string[] = [];
        for (const locale of ["en", "tr"]) {
            if (!STORE.translations[locale]?.store?.cartAriaLabelCounted) missing.push(`store.${locale}`);
            if (!BELL.translations[locale]?.notifications?.titleUnread) {
                // The bell's namespace is whichever block carries `title`.
                const named = Object.entries(BELL.translations[locale] ?? {})
                    .some(([, block]) => (block as Record<string, unknown>)?.titleUnread);
                if (!named) missing.push(`in-app-notifications.${locale}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("carry the count, rather than naming the control twice", () => {
        for (const locale of ["en", "tr"]) {
            expect(STORE.translations[locale].store.cartAriaLabelCounted).toContain("{count}");
        }
    });
});

describe("the badge itself", () => {
    it("stays out of the accessible tree, because the control already said it", () => {
        const source = fs.readFileSync(path.join(ROOT, "src/core/components/ui/count-badge.tsx"), "utf8");
        expect(source).toContain('aria-hidden="true"');
    });
});
