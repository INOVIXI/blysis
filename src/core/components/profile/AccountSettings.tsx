"use client";

import { useId, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Loader2, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { UrlOrFile } from "@/core/components/ui/url-or-file";
import { Label } from "@/core/components/ui/label";
import { authErrorMessage } from "@/core/lib/auth-error-message";
import { formatDate, dateLocaleTag } from "@/core/lib/utils";

export interface AccountIdentity {
    email: string;
    username: string;
    avatar: string | null;
    createdAt: string;
}

/**
 * The account's own details: what a member may change about themselves.
 *
 * Split out of the profile page, which had grown to three screens in one
 * file - this form, the privacy panel with its dialog, and the section
 * switcher - so none of the three could be read without the other two.
 */
export function AccountSettings({
    identity,
    onSaved,
}: {
    identity: AccountIdentity;
    /** Told the new name, so the page's own copy stays the one on screen. */
    onSaved: (next: { username: string; avatar: string | null }) => void;
}) {
    const t = useTranslations("profile");
    const authT = useTranslations("auth");
    const dateTag = dateLocaleTag(useLocale());

    const usernameId = useId();
    const avatarId = useId();
    const emailId = useId();
    const memberSinceId = useId();

    const [username, setUsername] = useState(identity.username);
    const [avatar, setAvatar] = useState(identity.avatar ?? "");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        setSaved(false);
        try {
            const res = await fetch("/api/v1/auth/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, avatar: avatar || null }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(authErrorMessage(authT, data, t("failedToUpdate")));
                return;
            }
            onSaved({ username, avatar: avatar || null });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch {
            setError(t("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("settings")}</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={submit} className="space-y-4">
                    {error && (
                        <div role="alert" className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg">
                            {error}
                        </div>
                    )}
                    {/* Two columns from the medium breakpoint up. The fields are
                        short and the page is the full measure now, so one per
                        line left a column of white space beside every input. */}
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <Label htmlFor={usernameId}>{t("username")}</Label>
                            <Input id={usernameId} value={username} onChange={(e) => setUsername(e.target.value)} />
                        </div>
                        <div>
                            {/* A member's own picture, uploaded through the one
                                door that is theirs: `/api/v1/me/avatar`, which
                                takes a small image and nothing else and can be
                                closed by the operator. The media library is an
                                admin tool and stays one. */}
                            <UrlOrFile
                                id={avatarId}
                                label={t("avatar")}
                                value={avatar}
                                onChange={setAvatar}
                                accept="image/*"
                                endpoint="/api/v1/me/avatar"
                            />
                        </div>
                        <div>
                            <Label htmlFor={emailId}>{t("email")}</Label>
                            <Input
                                id={emailId}
                                value={identity.email}
                                disabled
                                className="bg-muted"
                                aria-describedby={`${emailId}-help`}
                            />
                            <p id={`${emailId}-help`} className="text-xs text-muted-foreground mt-1">
                                {t("emailCannotChange")}
                            </p>
                        </div>
                        <div>
                            <Label htmlFor={memberSinceId}>{t("memberSince")}</Label>
                            <Input
                                id={memberSinceId}
                                value={formatDate(new Date(identity.createdAt), undefined, dateTag)}
                                disabled
                                className="bg-muted"
                            />
                        </div>
                    </div>
                    <Button type="submit" disabled={saving}>
                        {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("saving")}</>
                            : saved ? <><Check className="w-4 h-4" /> {t("saved")}</>
                                : t("saveChanges")}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}
