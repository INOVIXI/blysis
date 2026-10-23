"use client";

import { useTranslations } from "next-intl";
import { Slot } from "@/core/sdk/layout";
import { Link } from "@/core/sdk/navigation";
import { useSiteSettings } from "@/core/sdk/ui";
import { useThemeConfig } from "@/core/sdk/theme";
import { Stage } from "./Stage";
import { linkTarget } from "./links";

/**
 * The homepage's opening: a label, a heading, a line under it and up to two
 * buttons, on the stage.
 *
 * Every line falls back to the theme's own string in the reader's language
 * while the operator has not written one, so a fresh site is not greeted in
 * English. The first button is drawn only once it has somewhere to go; the
 * second is the site's Discord address from General settings, the same one
 * the footer links to. `hero.bottom` sits on the stage under them, where
 * modules that declare it expect to be.
 *
 * The heading is an h2: the homepage names itself in an h1 already.
 */
export default function Hero() {
    const t = useTranslations("vanguard");
    const get = useThemeConfig();
    const { settings } = useSiteSettings();
    if (!get<boolean>("hero.enabled", true)) return null;

    const text = (key: string) => (get<string>(key, "") ?? "").trim();
    const tag = text("hero.tag") || t("heroTag");
    const title = text("hero.title") || t("heroTitle");
    const subtitle = text("hero.subtitle") || t("heroSubtitle");
    const cta = linkTarget(get<string>("hero.ctaHref", ""));
    const ctaText = text("hero.ctaText");
    const discord = linkTarget(settings.site_discord_url);

    return (
        <section className="vg-hero">
            <Stage tall />
            <span className="vg-tag">{tag}</span>
            <h2 className="vg-hero-title">{title}</h2>
            <p className="vg-hero-lede">{subtitle}</p>
            {(cta && ctaText) || discord ? (
                <div className="vg-hero-actions">
                    {cta && ctaText ? (
                        cta.external ? (
                            <a href={cta.href} target="_blank" rel="noopener noreferrer" className="vg-cut-button" data-tone="primary">{ctaText}</a>
                        ) : (
                            <Link href={cta.href} className="vg-cut-button" data-tone="primary">{ctaText}</Link>
                        )
                    ) : null}
                    {discord ? (
                        <a href={discord.href} target="_blank" rel="noopener noreferrer" className="vg-cut-button" data-tone="glass">{t("joinDiscord")}</a>
                    ) : null}
                </div>
            ) : null}
            <div className="vg-hero-bottom">
                <Slot name="hero.bottom" />
            </div>
        </section>
    );
}
