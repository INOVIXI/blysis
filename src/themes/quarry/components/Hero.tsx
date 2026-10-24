"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/core/sdk";
import { Slot } from "@/core/sdk/layout";
import { Link } from "@/core/sdk/navigation";
import { Button, buttonClassName, useSiteSettings } from "@/core/sdk/ui";
import { linkTarget, useThemeConfig } from "@/core/sdk/theme";
import { Scene } from "./Scene";

type Copied = "idle" | "copied" | "failed";

/**
 * The homepage's opening, edge to edge under the bar: a label, a heading, a
 * line under it, the server's address one press from the clipboard and up to
 * two more buttons, over the operator's picture or the drawn landscape.
 *
 * Every line falls back to the theme's own string in the reader's language
 * while the operator has not written one. The address button is drawn only
 * once there is an address, and says so when the copy did not happen: a site
 * reached over plain http has no clipboard API, and `copyText` reports which
 * way it went. `hero.bottom` sits under the buttons, on the same dark ground.
 *
 * The heading is an h2: the homepage names itself in an h1 already.
 */
export default function Hero() {
    const t = useTranslations("quarry");
    const get = useThemeConfig();
    const { settings } = useSiteSettings();
    const [copied, setCopied] = useState<Copied>("idle");

    useEffect(() => {
        if (copied !== "copied") return;
        const timer = window.setTimeout(() => setCopied("idle"), 2500);
        return () => window.clearTimeout(timer);
    }, [copied]);

    if (!get<boolean>("hero.enabled", true)) return null;

    const text = (key: string) => (get<string>(key, "") ?? "").trim();
    const address = text("hero.address");
    const cta = linkTarget(get<string>("hero.ctaHref", ""));
    const ctaText = text("hero.ctaText");
    const discord = linkTarget(settings.site_discord_url);
    const picture = linkTarget(get<string>("hero.backgroundImage", ""));

    async function copy() {
        setCopied((await copyText(address)) ? "copied" : "failed");
    }

    return (
        <section className="qr-hero" data-picture={picture ? true : undefined}>
            {picture ? (
                <div aria-hidden="true" className="qr-hero-picture" style={{ backgroundImage: `url(${JSON.stringify(picture.href)})` }} />
            ) : (
                <Scene />
            )}
            <div className="qr-hero-inner container mx-auto px-4">
                <span className="qr-tag">{text("hero.tag") || t("heroTag")}</span>
                <h2 className="qr-hero-title">{text("hero.title") || t("heroTitle")}</h2>
                <p className="qr-hero-lede">{text("hero.subtitle") || t("heroSubtitle")}</p>
                {address || (cta && ctaText) || discord ? (
                    <div className="qr-hero-actions">
                        {address ? (
                            <Button size="lg" onClick={copy}>
                                {copied === "copied" ? <Check className="w-5 h-5" aria-hidden="true" /> : <Copy className="w-5 h-5" aria-hidden="true" />}
                                {copied === "copied" ? t("addressCopied") : t("copyAddress")}
                            </Button>
                        ) : null}
                        {cta && ctaText ? (
                            cta.external ? (
                                <a href={cta.href} target="_blank" rel="noopener noreferrer" className={buttonClassName(address ? "secondary" : "default", "lg")}>{ctaText}</a>
                            ) : (
                                <Link href={cta.href} className={buttonClassName(address ? "secondary" : "default", "lg")}>{ctaText}</Link>
                            )
                        ) : null}
                        {discord ? (
                            <a href={discord.href} target="_blank" rel="noopener noreferrer" className={buttonClassName("secondary", "lg")}>{t("joinDiscord")}</a>
                        ) : null}
                    </div>
                ) : null}
                {address ? (
                    <p className="qr-hero-address" aria-live="polite">
                        {copied === "failed" ? t("copyFailed") : t("addressLabel")}{" "}
                        <code className="qr-address">{address}</code>
                    </p>
                ) : null}
                <div className="qr-hero-bottom">
                    <Slot name="hero.bottom" />
                </div>
            </div>
        </section>
    );
}
