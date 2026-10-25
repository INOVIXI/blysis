"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, MessageCircle } from "lucide-react";
import { copyText } from "@/core/sdk";
import { Slot } from "@/core/sdk/layout";
import { Link } from "@/core/sdk/navigation";
import { Button, buttonClassName, useSiteSettings } from "@/core/sdk/ui";
import { PlaceholderText, linkTarget, useThemeConfig } from "@/core/sdk/theme";
import { Island } from "./Sky";

type Copied = "idle" | "copied" | "failed";

/**
 * A heading split after its first comma: the first part on a line of its
 * own, and the rest under it with a stroke of sunshine beneath its first
 * word. A heading with no comma is drawn on one line, with no stroke.
 */
function splitTitle(title: string): { head: string; stroke: string; rest: string } {
    const match = /^([^,，]+[,，])\s*(\S+)([\s\S]*)$/.exec(title);
    return match ? { head: match[1], stroke: match[2], rest: match[3] } : { head: title, stroke: "", rest: "" };
}

/**
 * The homepage's opening on the morning sky: a label, a heading over two
 * lines, a line under it, the server's address beside the button that copies
 * it, and on the right the theme's island with the kite flying from it.
 * Under it all, on a card of its own, the three steps from a closed game to
 * standing on the server.
 *
 * Every line falls back to the theme's own words in the reader's language
 * while the operator has not written one, and those words carry site
 * placeholders too: the line under the heading counts who is playing. The
 * address is copied through `copyText`, which says when the copy did not
 * happen, as it cannot over the plain http a fresh install is served on, and
 * the hero says so on the screen. `hero.tags` comes before the label, where
 * a module says whether the server is open.
 *
 * The heading is an h2: the homepage names itself in an h1 already.
 */
export default function Hero() {
    const t = useTranslations("kite");
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
    const { head, stroke, rest } = splitTitle(text("hero.title") || t("heroTitle"));
    const subtitle = text("hero.subtitle");
    const steps = get<boolean>("steps.enabled", true);

    async function copy() {
        setCopied((await copyText(address)) ? "copied" : "failed");
    }

    return (
        <section className="kt-hero container mx-auto px-4">
            <div className="kt-hero-words">
                <div className="kt-hero-tags">
                    <Slot name="hero.tags" />
                    <span className="kt-tag">{text("hero.tag") || t("heroTag")}</span>
                </div>
                <h2 className="kt-hero-title">
                    {head}
                    {stroke ? (
                        <>
                            {/* The space stays in the text, so the heading
                                reads and copies as the sentence it is. */}
                            {" "}
                            <br />
                            <span className="kt-hero-stroke">
                                {stroke}
                                <svg aria-hidden="true" viewBox="0 0 260 24" preserveAspectRatio="none">
                                    <path d="M4 16c40-12 80-12 120-4s90 6 132-8" />
                                </svg>
                            </span>
                            {rest}
                        </>
                    ) : null}
                </h2>
                <p className="kt-hero-lede">{subtitle || <PlaceholderText text={t.raw("heroSubtitle") as string} />}</p>
                {address || (cta && ctaText) || discord ? (
                    <div className="kt-hero-actions">
                        {address ? (
                            <div className="kt-address-box">
                                {/* Not `code`: the dark stylesheet boxes every code
                                    element in the muted colour, and the address
                                    is words on the sky, not a snippet. */}
                                <span className="sr-only">{t("addressLabel")}</span>
                                <span className="kt-address">{address}</span>
                                <Button size="lg" onClick={copy}>
                                    {copied === "copied" ? <Check className="w-5 h-5" aria-hidden="true" /> : <Copy className="w-5 h-5" aria-hidden="true" />}
                                    {copied === "copied" ? t("addressCopied") : t("copyAddress")}
                                </Button>
                            </div>
                        ) : null}
                        {cta && ctaText ? (
                            cta.external ? (
                                <a href={cta.href} target="_blank" rel="noopener noreferrer" className={buttonClassName("outline", "lg")}>{ctaText}</a>
                            ) : (
                                <Link href={cta.href} className={buttonClassName("outline", "lg")}>{ctaText}</Link>
                            )
                        ) : null}
                        {discord ? (
                            <a href={discord.href} target="_blank" rel="noopener noreferrer" className={`${buttonClassName("secondary", "lg")} kt-discord`}>
                                <MessageCircle className="w-5 h-5" aria-hidden="true" />
                                {t("joinDiscord")}
                            </a>
                        ) : null}
                    </div>
                ) : null}
                <p className="kt-hero-note" aria-live="polite">{copied === "failed" ? t("copyFailed") : null}</p>
            </div>
            <div className="kt-hero-art">
                <Island className="kt-island" />
            </div>
            {steps ? <Steps address={address} /> : null}
        </section>
    );
}

/** The three steps from a closed game to the server, the third naming the address. */
function Steps({ address }: { address: string }) {
    const t = useTranslations("kite");
    const get = useThemeConfig();
    const text = (key: string) => (get<string>(key, "") ?? "").trim();
    const items = [
        { title: text("steps.step1Title") || t("step1Title"), line: text("steps.step1Text") || t("step1Text") },
        { title: text("steps.step2Title") || t("step2Title"), line: text("steps.step2Text") || t("step2Text") },
        {
            title: text("steps.step3Title") || t("step3Title"),
            line: text("steps.step3Text") || (address ? t("step3Text", { address }) : t("step3TextPlain")),
        },
    ];
    return (
        <div className="kt-steps">
            <h3 className="kt-steps-title">{t("stepsTitle")}</h3>
            <ol className="kt-steps-list">
                {items.map((item, n) => (
                    <li key={n} className="kt-step">
                        <span aria-hidden="true" className="kt-step-number">{n + 1}</span>
                        <span>
                            <strong className="kt-step-title">{item.title}</strong>
                            <span className="kt-step-line">{item.line}</span>
                        </span>
                    </li>
                ))}
            </ol>
        </div>
    );
}
