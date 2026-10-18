"use client";

/**
 * Linking a game account to this site, from either side.
 *
 * A code made in game arrives here in the address. The page shows which game
 * account it would link before anything is spent, and the member agrees to
 * that account, not to a code: a code somebody else made and sent with a link
 * shows a stranger's name first. A member can also make a code here and type
 * it in game.
 */
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle, Link2, Loader2 } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, Input, Label, buttonClassName } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { gameName } from "../../../lib/game-name";

interface Preview {
    platform: string;
    name: string;
}

export default function LinkPage() {
    const t = useTranslations("gameConnect");
    const { status } = useSession();
    const fromAddress = useSearchParams()?.get("code") ?? "";
    const [code, setCode] = useState(fromAddress);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [linked, setLinked] = useState<Preview | null>(null);
    const [made, setMade] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const look = async (typed: string) => {
        setBusy(true);
        setError(null);
        setPreview(null);
        try {
            const res = await fetch(`/api/v1/game-connect/link/confirm?code=${encodeURIComponent(typed.trim())}`);
            if (res.ok) setPreview(await res.json());
            else setError(t(res.status === 429 ? "link_tooMany" : "link_wrongCode"));
        } catch {
            setError(t("link_failed"));
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (status === "authenticated" && fromAddress) look(fromAddress);
        // A code in the address is looked at once, when the session is known.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, fromAddress]);

    const confirmLink = async () => {
        if (!preview) return;
        setBusy(true);
        try {
            const res = await fetch("/api/v1/game-connect/link/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: code.trim(), account: preview.name }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) setLinked({ platform: data.platform, name: data.name });
            else setError(t(data.code === "already_linked" ? "link_already" : "link_wrongCode"));
        } catch {
            setError(t("link_failed"));
        } finally {
            setBusy(false);
        }
    };

    const makeCode = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/v1/game-connect/link/code", { method: "POST" });
            const data = await res.json().catch(() => ({}));
            if (res.ok) setMade(data.code);
            else setError(t(res.status === 429 ? "link_tooMany" : "link_failed"));
        } catch {
            setError(t("link_failed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <PageFrame title={t("link_title")} description={t("link_intro")}>
            <Card>
                <CardContent className="p-6 space-y-6">
                        {status === "loading" ? (
                            <div className="flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                        ) : status !== "authenticated" ? (
                            <Link href={`/auth/login?callbackUrl=${encodeURIComponent(`/link${fromAddress ? `?code=${fromAddress}` : ""}`)}`} className={buttonClassName("default", "default", "w-full")}>
                                {t("link_signIn")}
                            </Link>
                        ) : linked ? (
                            <div className="text-center space-y-2">
                                <CheckCircle className="w-8 h-8 text-success mx-auto" />
                                <p className="font-medium">{t("link_done", { name: linked.name })}</p>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="link-code">{t("link_codeFromGame")}</Label>
                                    <div className="flex gap-2">
                                        <Input id="link-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD1234" />
                                        <Button variant="outline" disabled={busy || code.trim().length < 4} onClick={() => look(code)}>{t("link_look")}</Button>
                                    </div>
                                </div>
                                {preview && (
                                    <div className="rounded-lg border border-border p-4 space-y-3">
                                        <p className="text-sm">{t("link_preview", { name: preview.name, platform: gameName(preview.platform) })}</p>
                                        <p className="text-xs text-muted-foreground">{t("link_previewWarn")}</p>
                                        <Button className="w-full" disabled={busy} onClick={confirmLink}>
                                            <Link2 className="w-4 h-4" /> {t("link_confirm", { name: preview.name })}
                                        </Button>
                                    </div>
                                )}
                                <div className="border-t border-border pt-4 space-y-2">
                                    <p className="text-sm text-muted-foreground">{t("link_otherWay")}</p>
                                    {made ? (
                                        <p className="text-center">
                                            <code className="font-mono text-lg bg-muted px-3 py-1 rounded">/verify {made}</code>
                                        </p>
                                    ) : (
                                        <Button variant="outline" className="w-full" disabled={busy} onClick={makeCode}>{t("link_makeCode")}</Button>
                                    )}
                                </div>
                            </>
                        )}
                        {error && <p role="alert" className="text-sm text-destructive text-center">{error}</p>}
                </CardContent>
            </Card>
        </PageFrame>
    );
}
