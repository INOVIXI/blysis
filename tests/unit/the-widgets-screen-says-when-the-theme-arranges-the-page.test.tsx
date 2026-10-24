// @vitest-environment jsdom
/**
 * Settings > Widgets says when the active theme arranges the homepage itself.
 *
 * A theme can ship its own arrangement in `theme.json`. A widget switched off
 * on this screen is still drawn nowhere, but the order saved here only places
 * the widgets that theme leaves to the page. Without a word about it, an
 * operator moved a widget up, saved, and watched the homepage stay as it was.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/admin/settings/widgets",
}));
vi.mock("@/core/providers/module-provider", () => ({ useAllModules: () => ({ sample: { enabled: true } }) }));
vi.mock("@/core/lib/module-enabled", () => ({ isEnabledIn: () => true }));
vi.mock("@/core/generated/module-registry", () => ({
    ModuleWidgets: [{ id: "NewsWidget", label: "News", component: "widgets/News", module: "sample", defaultOrder: 1, defaultVisible: true }],
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ settings: {} }), { status: 200 })));
});

const { WidgetSettingsScreen } = await import("@/app/[locale]/(admin)/admin/settings/widgets/WidgetSettingsScreen");

function draw(arrangedBy: string | null) {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <WidgetSettingsScreen arrangedBy={arrangedBy} />
        </NextIntlClientProvider>,
    );
}

describe("the widgets screen", () => {
    it("says the theme places its own widgets when it arranges the homepage", async () => {
        draw("Quarry");
        expect(await screen.findByText(/Quarry/)).toBeTruthy();
    });

    it("says nothing about it when the homepage is core's arrangement", async () => {
        draw(null);
        await screen.findByText("News");
        expect(screen.queryByText(/Quarry/)).toBeNull();
    });
});
