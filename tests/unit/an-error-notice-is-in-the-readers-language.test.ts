import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/**
 * The screens a person only ever sees on a bad day were the ones still in
 * English.
 *
 * An error boundary is a class component, and a class component cannot call a
 * hook, so its notice had been written as a literal and left there - which put
 * "Something went wrong" and "Reload Page" in front of a Turkish reader, and
 * "Failed to load ${moduleId}" in front of anyone whose homepage widget threw.
 * The reason given was that there is no provider to ask, and that was not so:
 * every one of these boundaries renders inside the locale layout's
 * `NextIntlClientProvider`. What a class cannot do, a function component
 * rendered by that class can.
 *
 * The genuinely untranslatable screens are the ones outside `[locale]`:
 * `app/global-error.tsx` replaces the root layout, and `app/error.tsx` and
 * `app/not-found.tsx` render above the provider. Those stay in English, and
 * this gate says so rather than leaving it to be rediscovered.
 */

const TRANSLATED = [
    "src/core/components/ErrorBoundary.tsx",
    "src/core/components/ModuleErrorBoundary.tsx",
    "src/core/components/ui/rich-text-editor.tsx",
];

/** Above the provider. There is nothing to ask, so English is the answer. */
const OUTSIDE_THE_PROVIDER = [
    "src/app/global-error.tsx",
    "src/app/error.tsx",
    "src/app/not-found.tsx",
];

/** A JSX text node that reads like a sentence or a label rather than a value. */
const ENGLISH_TEXT = />\s*([A-Z][A-Za-z][A-Za-z'’,.!?%: -]{3,60})\s*</g;

function englishLiterals(source: string): string[] {
    return [...source.matchAll(ENGLISH_TEXT)]
        .map((m) => m[1].trim())
        .filter((text) => /[a-z]/.test(text));
}

describe("an error notice follows the reader's locale", () => {
    it.each(TRANSLATED)("%s has no English baked into it", (file) => {
        expect(englishLiterals(read(file))).toEqual([]);
    });

    it.each(TRANSLATED)("%s asks for the catalogue", (file) => {
        expect(read(file)).toContain('useTranslations("common")');
    });

    it("the boundary renders inside the provider, which is what makes that possible", () => {
        const layout = read("src/app/[locale]/layout.tsx");
        const provider = layout.indexOf("<NextIntlClientProvider");
        const boundary = layout.indexOf("<ErrorBoundary>");
        const closed = layout.indexOf("</NextIntlClientProvider>");
        expect(provider).toBeGreaterThan(-1);
        expect(boundary).toBeGreaterThan(provider);
        expect(boundary).toBeLessThan(closed);
    });
});

describe("a failing module component is named to the console, not to the visitor", () => {
    const boundary = read("src/core/components/ModuleErrorBoundary.tsx");

    it("takes the id as a prop that only the console reads", () => {
        expect(boundary).toContain("componentId?: string");
        expect(boundary).toContain("this.props.componentId");
        expect(boundary).not.toContain("fallbackLabel");
    });

    it("shows the reader a translated line instead of an id", () => {
        expect(boundary).toContain('t("componentFailed")');
    });

    it("leaves no call site passing an English label", () => {
        const callers = [
            "src/app/[locale]/page.tsx",
            "src/core/components/ServerSlot.tsx",
            "src/core/components/Slot.tsx",
            "src/core/components/layout/ModuleLayoutComponents.tsx",
            "src/core/components/layout/Navbar.tsx",
        ];
        for (const file of callers) {
            expect(read(file), file).not.toContain("fallbackLabel");
            expect(read(file), file).toContain("componentId=");
        }
    });
});

describe("a toast is a sentence a person reads, so it is translated too", () => {
    it("the login form names the remaining backup codes through the catalogue", () => {
        const login = read("src/app/[locale]/(auth)/auth/login/page.tsx");
        expect(login).toContain("t('backupCodesRemaining', { count: remaining })");
        expect(login).not.toContain("backup codes remaining");
    });

    it("the theme library says what to do next through the catalogue", () => {
        const themes = read("src/app/[locale]/(admin)/admin/settings/theme/page.tsx");
        expect(themes).toContain('t("theme_installedRestart", { name: theme.name })');
        expect(themes).not.toContain("Restart server to activate");
    });
});

describe("the screens above the provider are English on purpose", () => {
    it.each(OUTSIDE_THE_PROVIDER)("%s is outside [locale] and stays as it is", (file) => {
        expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
        expect(file.startsWith("src/app/[locale]")).toBe(false);
        // If one of these ever gains a provider, it should gain a translation
        // too - and this line is what will fail when it does.
        expect(read(file)).not.toContain("useTranslations");
    });
});

describe("every key these screens ask for exists in every locale", () => {
    const KEYS: Array<[string, string]> = [
        ["common", "error_title"],
        ["common", "error_reported"],
        ["common", "reloadPage"],
        ["common", "componentFailed"],
        ["common", "retry"],
        ["auth", "backupCodesRemaining"],
        ["admin", "theme_installedRestart"],
    ];

    it.each(["en", "tr"])("%s", (locale) => {
        const messages = JSON.parse(read(`messages-core/${locale}.json`));
        for (const [namespace, key] of KEYS) {
            expect(messages[namespace]?.[key], `${locale}: ${namespace}.${key}`).toBeTruthy();
        }
    });
});
