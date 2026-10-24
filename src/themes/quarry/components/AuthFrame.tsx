"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { SiteMark, SiteName, type AuthFrameProps } from "@/core/sdk/theme";
import { Scene } from "./Scene";

/**
 * The sign-in, sign-up and password screens: the landscape behind the whole
 * screen, the site's mark and the way home across the top, and the form's
 * card in the middle. The card is whatever the page hands over, so a captcha
 * or a sign-in provider a module adds to it arrives here too.
 */
export default function AuthFrame({ children }: AuthFrameProps) {
    const t = useTranslations("auth");
    return (
        <div className="qr-auth">
            <Scene />
            <div className="qr-auth-frame">
                <header className="qr-auth-top">
                    <Link href="/" className="qr-brand">
                        <SiteMark size={36} />
                        <SiteName className="qr-brand-name" />
                    </Link>
                    <Link href="/" className="qr-auth-home">
                        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                        {t("backToHome")}
                    </Link>
                </header>
                <div className="qr-auth-card">{children}</div>
            </div>
        </div>
    );
}
