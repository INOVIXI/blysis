"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { SiteMark, SiteName, useThemeConfig, type AuthFrameProps } from "@/core/sdk/theme";
import { Stage } from "./Stage";

/**
 * The sign-in, sign-up and password screens: the whole screen is the stage,
 * the site's mark and the way home across the top, a few words of welcome on
 * one side and the form's card on the other.
 *
 * The words are the operator's from the theme's sign-in settings, or the
 * theme's own in the reader's language until they write some. The card is
 * whatever the page hands over, so a captcha or a sign-in provider a module
 * adds to it arrives here too.
 */
export default function AuthFrame({ children }: AuthFrameProps) {
    const t = useTranslations("vanguard");
    const authT = useTranslations("auth");
    const get = useThemeConfig();
    const text = (key: string) => (get<string>(key, "") ?? "").trim();

    return (
        <div className="vg-auth">
            <Stage tall />
            <div className="vg-auth-frame">
                <header className="vg-auth-top">
                    <Link href="/" className="vg-brand" data-on="stage">
                        <SiteMark size={40} className="vg-brand-mark" />
                        <SiteName className="vg-brand-name" />
                    </Link>
                    <Link href="/" className="vg-auth-home">
                        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                        {authT("backToHome")}
                    </Link>
                </header>
                <div className="vg-auth-body">
                    <section className="vg-auth-welcome">
                        <span className="vg-tag">{text("auth.tag") || t("authTag")}</span>
                        <p className="vg-auth-title">{text("auth.title") || t("authTitle")}</p>
                        <p className="vg-auth-lede">{text("auth.subtitle") || t("authSubtitle")}</p>
                    </section>
                    <div className="vg-auth-card">{children}</div>
                </div>
            </div>
        </div>
    );
}
