import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isKnownLocale } from "@/core/lib/i18n/resolve-locale";
import { buildSiteHead, buildPageMeta, buildOrganizationJsonLd } from "@/core/lib/seo";
import { Inter, Outfit, JetBrains_Mono } from "next/font/google";
import { buildTokenOverrideCss } from "@/core/lib/theme-override-css";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { publicMessages } from "@/core/lib/i18n/message-scopes";
import { SessionProvider } from "next-auth/react";
import { getSession } from "@/core/lib/auth";
import { AppThemeProvider } from "@/core/providers/theme-provider";
import { ModuleProvider } from "@/core/providers/module-provider";
import { getModuleStates } from "@/core/lib/module-cache";
import { getActiveTheme } from "@/core/lib/theme-state";
import { CustomCssInjector } from "@/core/components/layout/CustomCssInjector";
import { ModuleLayoutComponents } from "@/core/components/layout/ModuleLayoutComponents";
import { ServerSlot } from "@/core/components/ServerSlot";
import { ModuleContextProviders } from "@/core/components/layout/ModuleContextProviders";
import { SiteCurrencyProvider } from "@/core/components/currency/site-currency";
import { ConfirmProvider } from "@/core/components/ui/confirm-dialog";
import { ProgressBar } from "@/core/components/layout/ProgressBar";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/core/components/ErrorBoundary";
import { ImpersonationBanner } from "@/core/components/ImpersonationBanner";
import { Slot } from "@/core/components/Slot";
import "../globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  // Pull site_name/description from Settings, then layer root-layout-only
  // fields (title template, manifest) on top.
  // The site's own name comes from the setting, not from the environment.
  // Built from `serverConfig.name`, renaming a site in Admin > Settings
  // changed every heading on it and left the browser tab reading the old
  // name, because only this file can set a title template and this file was
  // asking the wrong thing. `buildSiteHead` reads the setting and lets a
  // module answer `seo.siteHead` on top of it.
  const head = await buildSiteHead();
  const base = await buildPageMeta({
    title: head.defaultTitle,
    type: "website",
    url: "/",
  });
  return {
    ...base,
    title: {
      default: head.defaultTitle,
      template: head.titleTemplate,
    },
    keywords: ["open source", "modular platform", "plugin marketplace"],
    manifest: "/manifest.webmanifest",
    authors: [{ name: head.defaultTitle }],
  };
}

export default async function RootLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // The proxy's page matcher skips any path containing a dot, which is how it
  // avoids running on files in /public. Nothing then validated the segment, so
  // a single-segment URL with a dot in it - `/wp-login.php`, `/index.php`,
  // `/anything.txt` - matched this layout with that string as the locale and
  // served the homepage under `<html lang="wp-login.php">`: a 200 for every
  // scanner probe, endless duplicate content for a crawler, and a language tag
  // no screen reader can act on.
  if (!isKnownLocale(locale)) {
    notFound();
  }

  const messages = await getMessages();
  const commonT = await getTranslations("common");

  // Process-wide bootstrap (hooks, scheduler, search indexes) lives in
  // src/instrumentation.ts. A layout render is a per-request event and was
  // never the right trigger for it.

  // Through the shared cache, not a raw findMany: this runs on every page
  // render, and the uncached version both re-queried per request and threw
  // the whole layout away on a database blip instead of failing soft.
  const moduleStates = await getModuleStates();

  // Resolve active theme + merged config on the server so the first paint
  // matches user customizations without a client round-trip.
  const active = await getActiveTheme();
  // Handed to the provider below so the client does not fetch what the server
  // already knows. Without it the first paint is anonymous and the header
  // rewrites itself once the request lands.
  const session = await getSession();

  // An override <style> block so admin-saved colour customizations take
  // effect: the generated theme-tokens.css sets the manifest defaults at
  // [data-theme][data-mode], and this appends the operator's at the same
  // specificity so the later declaration wins. Built by a function rather
  // than here, because this string is rendered as HTML and a token name that
  // is not a token name has no business reaching it.
  const overrideColors = ((active.tokenOverrides as { tokens?: { colors?: Record<string, unknown> } })?.tokens?.colors) ?? {};
  const overrideCss = buildTokenOverrideCss(active.themeId, active.mode, overrideColors);

  return (
    // The font variables belong on `html`, not on `body`: a custom property
    // is substituted on the element that declares it, and the theme tokens
    // are declared on `[data-theme][data-mode]`, which is this element. On
    // `body` a token could name `var(--font-inter)` and get nothing.
    //
    // `data-mode` is written here, by the server, so the first paint is
    // already in the visitor's mode. It used to be an inline script in
    // `<head>` reading localStorage - which the server cannot read, so the
    // page arrived in the site's mode and the script corrected it, and the
    // theme provider's effect corrected it straight back. Somebody who had
    // picked dark watched every load turn light. The dev build also warns
    // about a script tag in a component tree, for its own reason: one
    // rendered on the client never runs at all.
    <html
      lang={locale}
      suppressHydrationWarning
      data-theme={active.themeId}
      data-mode={active.mode}
      className={`${inter.variable} ${outfit.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: buildOrganizationJsonLd() }}
        />
        {overrideCss && <style dangerouslySetInnerHTML={{ __html: overrideCss }} />}
        <ServerSlot name="head.extra" moduleStates={moduleStates} />
      </head>
      <body className="antialiased bg-background">
        <SessionProvider session={session}>
          <NextIntlClientProvider messages={publicMessages(messages)}>
              <AppThemeProvider themeId={active.themeId} mode={active.mode} serverConfig={active.settings}>
                <ModuleProvider moduleStates={moduleStates}>
                <SiteCurrencyProvider>
                <ModuleContextProviders>
                <ConfirmProvider>
                  <a
                    href="#main-content"
                    className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[10001] focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary/70 focus:ring-offset-2"
                  >
                    {commonT("skipToContent")}
                  </a>
                  <ErrorBoundary>
                  <ImpersonationBanner />
                  <ProgressBar />
                  <CustomCssInjector />
                  <ModuleLayoutComponents />
                  <Slot name="layout.top" />
                  <Slot name="layout.beforeMain" />
                  {children}
                  <Slot name="layout.afterMain" />
                  </ErrorBoundary>
                  <div className="relative z-[9999]">
                    <Slot name="layout.overlay" />
                  </div>
                  {/* sonner names its own live region, and its default is English. */}
                  <Toaster
                    position="bottom-right"
                    richColors
                    closeButton
                    containerAriaLabel={commonT("notifications")}
                  />
                </ConfirmProvider>
                </ModuleContextProviders>
                </SiteCurrencyProvider>
                </ModuleProvider>
              </AppThemeProvider>
          </NextIntlClientProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
