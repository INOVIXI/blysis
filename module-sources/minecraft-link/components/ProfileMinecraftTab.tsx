"use client";

/**
 * Linking a Minecraft account, from the player's side.
 *
 * Two steps and no plugin: type your in-game name, read the code the server
 * whispers to you, type it back. The failure that actually happens - "you are
 * not on the server right now" - gets its own message, because it is the one
 * the person can fix.
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, useConfirm } from "@/core/sdk/ui";
import { Loader2, Link2, Link2Off } from "lucide-react";
import { writeError } from "@/core/sdk";

interface LinkState {
    account: { username: string; uuid: string | null; linkedAt: string } | null;
    pending: { username: string; expiresAt: string } | null;
}

export function ProfileMinecraftTab() {
    const t = useTranslations("minecraftLink");
    const { confirm } = useConfirm();

    const [state, setState] = useState<LinkState>({ account: null, pending: null });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [username, setUsername] = useState("");
    const [code, setCode] = useState("");
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/v1/minecraft-link");
            if (res.ok) setState(await res.json());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    /** Server-side error codes are stable; their wording is not. */
    const message = (key: string) => {
        const known = [
            "invalid_username",
            "already_linked",
            "no_server",
            "player_offline",
            "whisper_failed",
            "not-found",
            "expired",
            "too-many-attempts",
            "code_required",
        ];
        return t(known.includes(key) ? `err_${key.replace(/-/g, "_")}` : "err_unknown");
    };

    const request = async () => {
        setBusy(true);
        setError("");
        try {
            const res = await fetch("/api/v1/minecraft-link", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ username: username.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(message(data.error));
                return;
            }
            toast.success(t("codeSent", { username: data.username }));
            await load();
        } finally {
            setBusy(false);
        }
    };

    const confirmCode = async () => {
        setBusy(true);
        setError("");
        try {
            const res = await fetch("/api/v1/minecraft-link/confirm", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ code: code.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(message(data.error));
                return;
            }
            toast.success(t("linked", { username: data.username }));
            setCode("");
            setUsername("");
            await load();
        } finally {
            setBusy(false);
        }
    };

    const unlink = async () => {
        if (!(await confirm({ title: t("unlinkTitle"), message: t("unlinkConfirm"), variant: "danger" }))) return;
        setBusy(true);
        try {
            const res = await fetch("/api/v1/minecraft-link", { method: "DELETE" });
            const failed = await writeError(res, t("unlinkFailed"), t);
            if (failed) { toast.error(failed); return; }
            toast.success(t("unlinked"));
            await load();
        } finally {
            setBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 p-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("loading")}
            </div>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {state.account ? (
                    <>
                        <div>
                            <p className="text-sm text-muted-foreground">{t("linkedAs")}</p>
                            <p className="text-lg font-medium text-foreground">{state.account.username}</p>
                        </div>
                        <Button variant="outline" onClick={unlink} disabled={busy}>
                            <Link2Off className="h-4 w-4" />
                            {t("unlink")}
                        </Button>
                    </>
                ) : state.pending ? (
                    <>
                        <p className="text-sm text-muted-foreground">
                            {t("codeWhispered", { username: state.pending.username })}
                        </p>
                        <div className="space-y-2">
                            <Label htmlFor="mc-code">{t("codeLabel")}</Label>
                            <Input
                                id="mc-code"
                                value={code}
                                onChange={(e) => setCode(e.target.value.toUpperCase())}
                                placeholder="ABC123"
                                maxLength={6}
                                className="font-mono tracking-widest"
                            />
                        </div>
                        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                        <div className="flex gap-2">
                            <Button onClick={confirmCode} disabled={busy || code.trim().length < 6}>
                                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                                {t("confirm")}
                            </Button>
                            <Button variant="ghost" onClick={() => setState({ ...state, pending: null })}>
                                {t("startOver")}
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="text-sm text-muted-foreground">{t("intro")}</p>
                        <div className="space-y-2">
                            <Label htmlFor="mc-username">{t("usernameLabel")}</Label>
                            <Input
                                id="mc-username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Notch"
                                maxLength={16}
                            />
                        </div>
                        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                        <Button onClick={request} disabled={busy || username.trim().length < 3}>
                            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                            {t("sendCode")}
                        </Button>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
