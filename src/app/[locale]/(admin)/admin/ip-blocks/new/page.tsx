"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button, buttonClassName } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { NativeSelect } from "@/core/components/ui/native-select";
import { Link, useRouter } from "@/core/lib/i18n/navigation";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { errorMessage } from "@/core/lib/write-result";
import { cn } from "@/core/lib/utils";

/** Blocking an address, on its own route rather than folded above the list. */
export default function NewIpBlockPage() {
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const router = useRouter();

    const [ip, setIp] = useState("");
    const [scope, setScope] = useState<"all" | "admin" | "api">("all");
    const [reason, setReason] = useState("");
    const [expiresAt, setExpiresAt] = useState("");
    const [saving, setSaving] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!ip.trim()) {
            toast.error(t("ipBlocks_ipRequired"));
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/v1/admin/ip-blocks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ip: ip.trim(),
                    scope,
                    reason: reason.trim() || null,
                    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
                }),
            });
            if (res.ok) {
                toast.success(t("ipBlocks_created"));
                router.push("/admin/ip-blocks");
                router.refresh();
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("ipBlocks_createFailed"), t));
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <AdminPageHeader
                title={t("ipBlocks_newTitle")}
                description={t("ipBlocks_subtitle")}
                backHref="/admin/ip-blocks"
                backLabel={commonT("back")}
            />

            <Card>
                <CardContent className="p-6">
                    {/* Four fields in two columns. The form used to be
                        capped at `max-w-xl` inside a card that stretched
                        anyway, so the card drew a border around an empty
                        right half of the panel. */}
                    <form onSubmit={submit} className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                                <Label htmlFor="ip-block-ip">{t("ipBlocks_ipLabel")}</Label>
                                <Input
                                    id="ip-block-ip"
                                    value={ip}
                                    onChange={(e) => setIp(e.target.value)}
                                    placeholder="1.2.3.4 or 192.168.0.0/24"
                                    autoComplete="off"
                                    required
                                />
                                <p className="text-xs text-muted-foreground mt-1">{t("ipBlocks_ipHint")}</p>
                            </div>
                            <div>
                                <Label htmlFor="ip-block-scope">{t("ipBlocks_scope")}</Label>
                                <NativeSelect
                                    id="ip-block-scope"
                                    value={scope}
                                    onChange={(e) => setScope(e.target.value as "all" | "admin" | "api")}
                                >
                                    <option value="all">{t("ipBlocks_scopeAll")}</option>
                                    <option value="admin">{t("ipBlocks_scopeAdmin")}</option>
                                    <option value="api">{t("ipBlocks_scopeApi")}</option>
                                </NativeSelect>
                            </div>
                            <div>
                                <Label htmlFor="ip-block-reason">{t("ipBlocks_reason")}</Label>
                                <Input
                                    id="ip-block-reason"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder={t("ipBlocks_reasonPlaceholder")}
                                />
                            </div>
                            <div>
                                <Label htmlFor="ip-block-expires">{t("ipBlocks_expiresAt")}</Label>
                                <Input
                                    id="ip-block-expires"
                                    type="datetime-local"
                                    value={expiresAt}
                                    onChange={(e) => setExpiresAt(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground mt-1">{t("ipBlocks_expiresHint")}</p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button type="submit" disabled={saving}>
                                {saving ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        {t("ipBlocks_saving")}
                                    </>
                                ) : (
                                    t("ipBlocks_save")
                                )}
                            </Button>
                            <Link href="/admin/ip-blocks" className={cn(buttonClassName("outline", "default"), saving && "pointer-events-none opacity-50")} aria-disabled={saving} tabIndex={saving ? -1 : undefined}>
                                    {commonT("cancel")}
                                </Link>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </>
    );
}
