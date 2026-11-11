/**
 * The site settings the server draws are the ones the browser hydrates with.
 *
 * `useSiteSettings` began every render from a cache that lives only in the
 * browser. On the server that cache is empty, so the navbar was sent reading
 * the shipped name, "Blysis", the footer with no description and every price
 * in USD. In the browser the boundaries that hydrate later found the payload
 * an earlier component had already fetched and rendered the operator's name
 * on their first pass, so the text React was handed did not match the text
 * it drew. A live site logged "Minified React error #418" on every page.
 *
 * The root layout now reads the public settings on the server and hands them
 * to `SiteSettingsProvider`; the hook starts from those on both sides.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import { SiteName } from "@/core/components/ui/site-name";
import { SiteSettingsProvider } from "@/core/providers/site-settings-provider";
import { SiteCurrencyProvider, useSiteCurrency } from "@/core/components/currency/site-currency";
import { useSiteSettings } from "@/core/hooks/useSiteSettings";
import { invalidateShared, peekShared, sharedJson } from "@/core/lib/shared-request";

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));
const PAYLOAD = { settings: { site_name: "Vanilya", default_currency: "TRY" }, cacheSeconds: 60 };

function Price() {
    const { code } = useSiteCurrency();
    return <span>{code}</span>;
}

function Loaded() {
    const { loaded } = useSiteSettings();
    return <span>{loaded ? "loaded" : "waiting"}</span>;
}

const tree = (
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <SiteSettingsProvider payload={PAYLOAD}>
            <SiteCurrencyProvider>
                <SiteName />|<Price />|<Loaded />
            </SiteCurrencyProvider>
        </SiteSettingsProvider>
    </NextIntlClientProvider>
);

describe("the site settings a page is drawn with", () => {
    beforeEach(() => {
        invalidateShared();
        vi.restoreAllMocks();
        // Nothing here may reach the network; the first render is the point.
        vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    });

    it("are the operator's on the server, not the shipped fallback", () => {
        const html = renderToString(tree);
        expect(html).toContain("Vanilya");
        expect(html).not.toContain("Blysis");
        expect(html).toContain("TRY");
        expect(html).toContain("loaded");
    });

    it("are the same on the browser's first render, even with a newer answer already fetched", async () => {
        // A boundary that hydrates late finds what an earlier component
        // fetched. Drawing that on the first pass is the mismatch; the
        // hydration pass has to draw what the server drew.
        const served = renderToString(tree);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ settings: { site_name: "Renamed since" }, cacheSeconds: 60 }),
        }));
        await sharedJson("/api/v1/public-settings");
        const { container } = render(tree);
        expect(container.innerHTML).toBe(served);
    });

    it("leave the browser's cache holding the server's answer, so nothing asks again", () => {
        render(tree);
        expect(peekShared("/api/v1/public-settings")).toEqual(PAYLOAD);
        expect(fetch).not.toHaveBeenCalled();
    });
});
