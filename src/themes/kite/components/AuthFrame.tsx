"use client";

import { useTranslations } from "next-intl";
import { Footer, Navbar, Slot } from "@/core/sdk/layout";
import { usePathname } from "@/core/sdk/navigation";
import { PlaceholderText, useThemeConfig, type AuthFrameProps } from "@/core/sdk/theme";
import { Island } from "./Sky";

/**
 * The sign-in, sign-up and password screens inside the site's own frame:
 * one wide card on the morning sky, the form on its left and on its right a
 * piece of sky with the theme's island, a line about who is playing and what
 * a module has to say to someone coming back or someone new.
 *
 * The line is the operator's, or the theme's own in the reader's language,
 * and either can carry site placeholders. Sign-in hands its aside to modules
 * as `auth.login.aside` and sign-up as `auth.register.aside`; the password
 * screens have none. The form side holds whatever the page hands over, so a
 * captcha or a sign-in provider a module adds arrives there too.
 */
export default function AuthFrame({ children }: AuthFrameProps) {
    const t = useTranslations("kite");
    const get = useThemeConfig();
    const pathname = usePathname();
    const signUp = pathname.startsWith("/auth/register");
    const signIn = pathname.startsWith("/auth/login");
    const aside = signUp ? "auth.register.aside" : signIn ? "auth.login.aside" : null;
    const headline = (get<string>("auth.headline", "") ?? "").trim();

    return (
        <div className="kt-site min-h-screen flex flex-col">
            <div className="kt-bar">
                <Navbar />
            </div>
            <main className="kt-auth container mx-auto px-4 flex-1">
                <div className="kt-auth-card">
                    <div className="kt-auth-form">
                        <p className="kt-auth-kicker">{signUp ? t("authKickerRegister") : t("authKickerLogin")}</p>
                        {children}
                    </div>
                    <div className="kt-auth-sky">
                        <Island className="kt-auth-island" />
                        <p className="kt-auth-headline">{headline || <PlaceholderText text={t.raw("authHeadline") as string} />}</p>
                        {aside ? (
                            <div className="kt-auth-aside">
                                <Slot name={aside} />
                            </div>
                        ) : null}
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
}
