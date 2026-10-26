"use client";

import React from "react";
import { Home } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/core/lib/i18n/navigation";
import { SiteName } from "@/core/components/ui/site-name";
import { ThemeComponentSlot } from "@/core/components/theme/ThemeComponentSlot";

export interface AuthFrameProps {
    children: React.ReactNode;
}

function DefaultAuthFrame({ children }: AuthFrameProps) {
    const t = useTranslations("auth");
    return (
        <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12 relative">
            <Link
                href="/"
                aria-label={t("backToHome")}
                className="absolute top-6 left-6 w-10 h-10 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
            >
                <Home className="w-5 h-5" aria-hidden="true" />
            </Link>

            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <Link href="/" className="inline-flex items-center gap-3">
                        <SiteName className="font-bold text-2xl text-foreground" />
                    </Link>
                </div>
                {children}
            </div>
        </div>
    );
}

/**
 * The screen around a sign-in, sign-up or password form.
 *
 * Five pages drew the same frame by hand: the way home, the site's name and
 * a narrow column. A theme that brings an `AuthFrame` draws the screen its own
 * way and is handed the form's card as `children`; it decides where the card
 * sits, not what is in it.
 */
export function AuthFrame({ children }: AuthFrameProps) {
    return <ThemeComponentSlot name="AuthFrame" fallback={DefaultAuthFrame}>{children}</ThemeComponentSlot>;
}
