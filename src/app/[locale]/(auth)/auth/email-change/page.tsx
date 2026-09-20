"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Check, X } from "lucide-react";
import { Link } from "@/core/lib/i18n/navigation";
import { buttonClassName } from "@/core/components/ui/button";
import { authErrorMessage } from "@/core/lib/auth-error-message";

/**
 * Where the link in the confirmation mail lands.
 *
 * It spends the token as soon as it loads, because the member has already
 * made the decision - they clicked it - and a second button here would only
 * ask them to confirm that they meant to confirm.
 *
 * No session is required. The person holding the mailbox is the person this
 * proves, and asking them to sign in first would break the ordinary case: the
 * link is opened on a phone, hours later, in whatever client shows the mail.
 */
export default function EmailChangePage() {
    const t = useTranslations("auth");
    const params = useSearchParams();
    const token = params.get("token") ?? "";
    const [state, setState] = useState<"working" | "done" | "failed">("working");
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (!token) {
            setState("failed");
            setMessage(t("emailChangeFailedBody"));
            return;
        }
        let current = true;
        fetch("/api/v1/auth/email-change", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        })
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (!current) return;
                if (res.ok) {
                    setState("done");
                    return;
                }
                setState("failed");
                setMessage(authErrorMessage(t, data, t("emailChangeFailedBody")));
            })
            .catch(() => {
                if (!current) return;
                setState("failed");
                setMessage(t("emailChangeFailedBody"));
            });
        return () => { current = false; };
    }, [token, t]);

    return (
        <div className="max-w-md mx-auto text-center py-16 px-4">
            {state === "working" && (
                <>
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                    <p className="mt-4 text-muted-foreground">{t("emailChangeWorking")}</p>
                </>
            )}
            {state === "done" && (
                <>
                    <Check className="w-8 h-8 mx-auto text-success" />
                    <h1 className="mt-4 text-xl font-semibold">{t("emailChangeDone")}</h1>
                    <p className="mt-2 text-muted-foreground">{t("emailChangeDoneBody")}</p>
                    <Link href="/profile" className={buttonClassName("default", "default", "mt-6")}>
                        {t("emailChangeBackToProfile")}
                    </Link>
                </>
            )}
            {state === "failed" && (
                <>
                    <X className="w-8 h-8 mx-auto text-destructive" />
                    <h1 className="mt-4 text-xl font-semibold">{t("emailChangeFailed")}</h1>
                    <p className="mt-2 text-muted-foreground">{message}</p>
                    <Link href="/profile" className={buttonClassName("outline", "default", "mt-6")}>
                        {t("emailChangeBackToProfile")}
                    </Link>
                </>
            )}
        </div>
    );
}
