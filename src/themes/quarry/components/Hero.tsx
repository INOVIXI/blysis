"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/core/sdk";
import { Slot } from "@/core/sdk/layout";
import { Link } from "@/core/sdk/navigation";
import { Button, buttonClassName, useSiteSettings } from "@/core/sdk/ui";
import { linkTarget, useThemeConfig } from "@/core/sdk/theme";
import heroPicture from "@/themes/quarry/pictures/hero.jpg";

type Copied = "idle" | "copied" | "failed";

/**
 * A heading of several sentences, split before its last one, which is drawn
 * on a line of its own in the accent colour. One sentence is not split.
 */
function splitTitle(title: string): [string, string] {
    const match = /^([\s\S]*[.!?])\s+(\S[\s\S]*)$/.exec(title);
    return match ? [match[1], match[2]] : [title, ""];
}

/**
 * The homepage's opening, edge to edge under the bar: a label, a heading, a
 * line under it, the server's address one press from the clipboard and up to
 * two more buttons, over the operator's picture or the theme's own.
 *
 * Every line falls back to the theme's own string in the reader's language
 * while the operator has not written one. The address button is drawn only
 * once there is an address, and says so when the copy did not happen: a site
 * reached over plain http has no clipboard API, and `copyText` reports which
 * way it went. `hero.tags` comes before the label, where a module says
 * whether the server is open; `hero.bottom` sits under the buttons, on the
 * same dark ground.
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
    const picture = linkTarget(get<string>("hero.backgroundImage", ""))?.href ?? heroPicture.src;

    const [head, tail] = splitTitle(text("hero.title") || t("heroTitle"));

    async function copy() {
        setCopied((await copyText(address)) ? "copied" : "failed");
    }

    return (
        <section className="qr-hero">
            <div aria-hidden="true" className="qr-hero-picture" style={{ backgroundImage: `url(${JSON.stringify(picture)})` }} />
            <div className="qr-hero-inner container mx-auto px-4">
                <div className="qr-hero-tags">
                    <Slot name="hero.tags" />
                    <span className="qr-tag">{text("hero.tag") || t("heroTag")}</span>
                </div>
                <h2 className="qr-hero-title">
                    {head}
                    {tail ? <>{" "}<span className="qr-hero-accent">{tail}</span></> : null}
                </h2>
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
                        {/* Not `code`: the dark stylesheet boxes every code
                            element in the muted colour, and the address is
                            words on the hero, not a snippet. */}
                        <span className="qr-address">{address}</span>
                    </p>
                ) : null}
                <div className="qr-hero-bottom">
                    <Slot name="hero.bottom" />
                </div>
            </div>
        </section>
    );
}
