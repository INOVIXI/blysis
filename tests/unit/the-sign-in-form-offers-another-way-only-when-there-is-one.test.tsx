/**
 * The sign-in form says "or continue with" only when something follows it.
 *
 * The divider was drawn on every sign-in screen, and the provider buttons
 * under it only when a sign-in module was installed and had credentials. On
 * a fresh site that is none of them, so every visitor read "or continue
 * with" above nothing at all, which reads as a sign-in option that failed to
 * load.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({ providers: [] as string[] }));

vi.mock("@/core/generated/module-registry", () => ({
    ModuleOauthButtons: [
        { id: "discord", module: "discord-auth", provider: "discord", label: "Discord", color: "#5865F2", svgIcon: "M0 0h24v24H0z" },
    ],
}));
vi.mock("@/core/providers/module-provider", () => ({ useAllModules: () => ({ "discord-auth": true }) }));
vi.mock("@/core/lib/module-enabled", () => ({ isEnabledIn: () => true }));
vi.mock("@/core/components/auth/Challenge", () => ({
    useChallenge: () => ({ token: null, reset: () => {} }),
    Challenge: () => null,
}));
vi.mock("@/core/components/layout/AuthFrame", () => ({
    AuthFrame: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));
const { default: LoginPage } = await import("@/app/[locale]/(auth)/auth/login/page");

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (String(url).includes("/auth/providers") ? { providers: state.providers } : {}),
    })));
});

function draw() {
    return render(<NextIntlClientProvider locale="en" messages={MESSAGES}><LoginPage /></NextIntlClientProvider>);
}

describe("the sign-in form", () => {
    it("says nothing about other ways in when there are none", async () => {
        state.providers = [];
        draw();
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(screen.queryByText(MESSAGES.auth.orContinueWith)).toBeNull();
    });

    it("offers them under the divider when there is one", async () => {
        state.providers = ["discord"];
        draw();
        await screen.findByRole("button", { name: /Discord/ });
        expect(screen.getByText(MESSAGES.auth.orContinueWith)).toBeTruthy();
    });
});
