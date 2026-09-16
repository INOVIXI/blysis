/**
 * Titles and descriptions for the pages core renders itself.
 *
 * Ten of them shipped with neither. A page can only name itself through
 * `generateMetadata`, a server export, and these are client components: the
 * root layout's `title.default` was the only thing left, so the tab and the
 * search snippet for the login screen, the register screen, the profile and
 * the site search all read "Blysis" and nothing else. Only `/activity` had a
 * description at all.
 *
 * The fix does not move the pages to the server. Each one gets a sibling
 * layout that exports the metadata and renders its children untouched, and
 * every layout reads its entry from the table below, so a new core page is
 * one row plus two translation keys rather than a hand-written head.
 *
 * `index: false` is set only where a crawler can actually read it. `/auth` and
 * `/profile` are already Disallow-ed in robots.txt, and a page a crawler is
 * told not to fetch is a page it will never see a meta tag on, so a noindex
 * there would be a claim nobody reads. `/search` and `/maintenance` are
 * crawlable: site search answers an unbounded set of `?q=` URLs with one
 * shell, and the maintenance screen is a page whose whole content is an
 * apology for the site being down.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildPageMeta } from "./seo";

export interface CoreScreen {
    /** Path below the locale segment, matching the directory that renders it. */
    path: string;
    /** `namespace.key` into messages-core, in the visitor's language. */
    titleKey: string;
    descriptionKey: string;
    /** Defaults to true; false emits `robots: noindex, follow`. */
    index?: boolean;
}

export const CORE_SCREENS: CoreScreen[] = [
    { path: "/auth/login", titleKey: "auth.signIn", descriptionKey: "auth.loginSubtitle" },
    { path: "/auth/register", titleKey: "auth.registerTitle", descriptionKey: "auth.registerSubtitle" },
    { path: "/auth/forgot-password", titleKey: "auth.forgotPassword", descriptionKey: "auth.forgotSubtitle" },
    { path: "/auth/reset-password", titleKey: "auth.resetTitle", descriptionKey: "auth.resetSubtitle" },
    { path: "/auth/verify-email", titleKey: "auth.verifyTitle", descriptionKey: "auth.verifyMetaDescription" },
    { path: "/auth/error", titleKey: "auth.errorTitle", descriptionKey: "auth.errorDefault" },
    { path: "/activity", titleKey: "activity.title", descriptionKey: "activity.description" },
    { path: "/profile", titleKey: "profile.title", descriptionKey: "profile.metaDescription" },
    { path: "/search", titleKey: "search.title", descriptionKey: "search.metaDescription", index: false },
    { path: "/maintenance", titleKey: "maintenance.title", descriptionKey: "maintenance.defaultMessage", index: false },
];

export function coreScreen(path: string): CoreScreen | undefined {
    return CORE_SCREENS.find((s) => s.path === path);
}

interface LocaleParams {
    params: Promise<{ locale: string }>;
}

/**
 * The `generateMetadata` export for one core screen. A layout writes
 * `export const generateMetadata = coreScreenMetadata("/auth/login");`
 * and nothing else about its head.
 */
export function coreScreenMetadata(path: string) {
    return async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
        const screen = coreScreen(path);
        if (!screen) throw new Error(`No CORE_SCREENS entry for ${path}`);

        const { locale } = await params;
        const title = await translate(locale, screen.titleKey);
        const description = await translate(locale, screen.descriptionKey);

        const meta = await buildPageMeta({
            title,
            ...(description ? { description } : {}),
            url: path,
            locale,
            type: "website",
        });
        // An unresolved key must not blank the tab: dropping `title` lets the
        // root layout's default stand, which is what shipped before this.
        if (!title) delete meta.title;
        return screen.index === false ? { ...meta, robots: { index: false, follow: true } } : meta;
    };
}

/**
 * One `namespace.key` in one language. A missing key must not take the page
 * down with it, and next-intl's default for one is to render the key itself,
 * which as a title would put `auth.signIn` in the visitor's tab.
 */
async function translate(locale: string, dotted: string): Promise<string> {
    const [namespace, ...rest] = dotted.split(".");
    const key = rest.join(".");
    if (!namespace || !key) return "";
    try {
        const t = await getTranslations({ locale, namespace });
        if (!t.has(key)) return "";
        const value = t(key);
        return typeof value === "string" && value.trim() && value !== dotted ? value : "";
    } catch {
        return "";
    }
}
