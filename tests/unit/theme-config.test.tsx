import { describe, it, expect } from "vitest";
import { render as renderBare, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { ThemeConfigProvider, useThemeConfig } from "@/core/lib/theme-config";

// A text setting comes back in the reader's language, which is the page's
// locale, so the hook is drawn inside the provider every page has.
const render = (ui: ReactNode) => renderBare(ui, {
    wrapper: ({ children }) => <NextIntlClientProvider locale="en" messages={{}}>{children}</NextIntlClientProvider>,
});

function Probe({ path }: { path: string }) {
    const cfg = useThemeConfig();
    return <span data-testid="v">{String(cfg(path) ?? "∅")}</span>;
}

describe("useThemeConfig", () => {
    it("returns value at a dot path", () => {
        render(
            <ThemeConfigProvider value={{ hero: { headline: "hi" } }}>
                <Probe path="hero.headline" />
            </ThemeConfigProvider>,
        );
        expect(screen.getByTestId("v").textContent).toBe("hi");
    });

    it("returns undefined on missing path", () => {
        render(
            <ThemeConfigProvider value={{}}>
                <Probe path="a.b" />
            </ThemeConfigProvider>,
        );
        expect(screen.getByTestId("v").textContent).toBe("∅");
    });

    it("supports an explicit default", () => {
        function DefaultProbe() {
            const cfg = useThemeConfig();
            return <span data-testid="v">{String(cfg("missing", "fallback"))}</span>;
        }
        render(<ThemeConfigProvider value={{}}><DefaultProbe /></ThemeConfigProvider>);
        expect(screen.getByTestId("v").textContent).toBe("fallback");
    });
});
