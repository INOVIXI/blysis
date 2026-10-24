"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/core/sdk";
import { Slot } from "@/core/sdk/layout";
import { Link, usePathname } from "@/core/sdk/navigation";
import { Button, NavIcon } from "@/core/sdk/ui";
import { SiteMark, linkTarget, useNavLinks, useThemeConfig, type AuthFrameProps } from "@/core/sdk/theme";
import { Scene } from "./Scene";

type Copied = "idle" | "copied" | "failed";

/**
 * The sign-in, sign-up and password screens, laid out like a game's
 * launcher: the site's menu in a rail, a picture with the server's state and
 * the hero's label on it, and the form in a panel beside it with the address one press away.
 *
 * Sign-in and sign-up each wear the operator's picture for that form, or the
 * drawn landscape until there is one, and each hands an aside to modules
 * under its own name: `auth.login.aside` for someone coming back,
 * `auth.register.aside` for someone new. The other account screens wear the
 * sign-in picture and no aside. The panel holds whatever the page hands
 * over, so a captcha or a sign-in provider a module adds arrives there too.
 */
export default function AuthFrame({ children }: AuthFrameProps) {
    const t = useTranslations("quarry");
    const authT = useTranslations("auth");
    const navT = useTranslations("nav");
    const get = useThemeConfig();
    const pathname = usePathname();
    const { links } = useNavLinks();
    const [copied, setCopied] = useState<Copied>("idle");

    useEffect(() => {
        if (copied !== "copied") return;
        const timer = window.setTimeout(() => setCopied("idle"), 2500);
        return () => window.clearTimeout(timer);
    }, [copied]);

    const signUp = pathname.startsWith("/auth/register");
    const signIn = pathname.startsWith("/auth/login");
    const picture = linkTarget(get<string>(signUp ? "auth.registerImage" : "auth.loginImage", ""));
    const text = (key: string) => (get<string>(key, "") ?? "").trim();
    const address = text("hero.address");
    const aside = signUp ? "auth.register.aside" : signIn ? "auth.login.aside" : null;
    // A folded group is its own entries in a rail, which has no menus.
    const railLinks = links.flatMap((link) => (link.children && link.children.length > 0 ? link.children : [link]));

    async function copy() {
        setCopied((await copyText(address)) ? "copied" : "failed");
    }

    return (
        <div className="qr-auth">
            <nav className="qr-auth-rail" aria-label={navT("primary")}>
                <Link href="/" className="qr-auth-rail-home" aria-label={authT("backToHome")}>
                    <SiteMark size={40} />
                </Link>
                {railLinks.map((link) => (
                    <Link key={link.href} href={link.href} className="qr-auth-rail-link">
                        <NavIcon name={link.icon} className="w-5 h-5" />
                        <span>{link.label}</span>
                    </Link>
                ))}
            </nav>

            <div className="qr-auth-scene">
                {picture ? (
                    <div aria-hidden="true" className="qr-auth-picture" style={{ backgroundImage: `url(${JSON.stringify(picture.href)})` }} />
                ) : (
                    <Scene />
                )}
                <div className="qr-hero-tags">
                    <Slot name="hero.tags" />
                    <span className="qr-tag">{text("hero.tag") || t("heroTag")}</span>
                </div>
                {aside ? (
                    <div className="qr-auth-aside">
                        <Slot name={aside} />
                    </div>
                ) : null}
            </div>

            <main className="qr-auth-panel">
                <p className="qr-auth-kicker">{signUp ? t("authKickerRegister") : t("authKickerLogin")}</p>
                <div className="qr-auth-card">{children}</div>
                {address ? (
                    <div className="qr-auth-address">
                        <p aria-live="polite">
                            <span>{copied === "failed" ? t("copyFailed") : t("addressLabel")}</span>
                            <span className="qr-address">{address}</span>
                        </p>
                        <Button variant="secondary" size="sm" onClick={copy}>
                            {copied === "copied" ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                            {copied === "copied" ? t("addressCopied") : t("copyAddress")}
                        </Button>
                    </div>
                ) : null}
            </main>
        </div>
    );
}
