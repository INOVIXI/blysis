"use client";

import { useState, useEffect, useId } from "react";
import { MemberAvatar } from "@/core/components/ui/MemberAvatar";
import { useModalDialog } from "@/core/hooks/useModalDialog";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Link } from "@/core/lib/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button, buttonClassName } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { Loader2, Check, Ban, ShieldCheck, Download, Trash2, AlertTriangle, UserCog } from "lucide-react";
import { formatDate } from "@/core/lib/utils";
import { toast } from "sonner";
import { useConfirm, usePrompt } from "@/core/components/ui/confirm-dialog";
import { useTranslations, useLocale } from "next-intl";
import { dateLocaleTag } from "@/core/lib/utils";
import { writeError, errorMessage } from "@/core/lib/write-result";
import { NativeSelect } from "@/core/components/ui/native-select";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { CustomerView } from "./CustomerView";

interface UserDetail {
    id: string;
    email: string;
    username: string;
    avatar: string | null;
    locale: string;
    currency: string;
    createdAt: string;
    isBanned: boolean;
    banReason: string | null;
    bannedAt: string | null;
    role: { id: string; name: string; displayName: string; color: string | null } | null;
    _count: Record<string, number>;
}

interface Role {
    id: string;
    name: string;
    displayName: string;
}

export default function AdminUserDetailPage() {
    const t = useTranslations("admin");
    const locale = useLocale();
    const dateTag = dateLocaleTag(locale);
    const params = useParams();
    const userId = params.id as string;
    const { data: session, update: updateSession } = useSession();
    const { confirm } = useConfirm();
    const ask = usePrompt();

    const [user, setUser] = useState<UserDetail | null>(null);
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [impersonating, setImpersonating] = useState(false);

    const [form, setForm] = useState({
        username: "",
        email: "",
        roleId: "",
    });

    // Stable ids for label associations
    const usernameId = useId();
    const emailFieldId = useId();
    const roleFieldId = useId();
    const deleteConfirmUsernameId = useId();
    const deleteReasonId = useId();

    // GDPR tooling
    const [exportingData, setExportingData] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteConfirmUsername, setDeleteConfirmUsername] = useState("");
    const [deleteReason, setDeleteReason] = useState("");
    const [deletingAccount, setDeletingAccount] = useState(false);
    const [deleteError, setDeleteError] = useState("");

    const canImpersonate =
        !!session?.user &&
        !session.user.originalUserId &&
        session.user.id !== userId;

    const handleImpersonate = async () => {
        if (!user) return;
        const ok = await confirm({
            title: t("users_impersonateConfirm"),
            message: t("users_impersonateMessage", { username: user.username }),
            confirmText: t("users_impersonateButton"),
            cancelText: t("users_cancel"),
            variant: "default",
        });
        if (!ok) return;

        setImpersonating(true);
        try {
            const res = await fetch("/api/v1/admin/impersonate/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) {
                toast.error(errorMessage(data, t("users_impersonateFailed"), t));
                return;
            }
            await updateSession({ impersonate: userId });
            toast.success(t("users_nowLoggedAs", { username: user.username }));
            // A hard navigation on purpose. Impersonation changes who the SERVER
            // thinks you are, and every server component in the tree has already
            // rendered against the old session. router.push() would keep that
            // cached tree and show the admin their own permissions while acting
            // as someone else.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = `/${locale}`;
        } catch {
            toast.error(t("users_impersonateFailed"));
        } finally {
            setImpersonating(false);
        }
    };

    const handleExportUserData = async () => {
        setExportingData(true);
        try {
            const res = await fetch(`/api/v1/users/${userId}/export`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                toast.error(errorMessage(body, t("users_exportFailed"), t));
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const cd = res.headers.get("Content-Disposition") || "";
            const match = cd.match(/filename="([^"]+)"/);
            a.download = match?.[1] || `blysis-data-${userId}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast.success(t("users_dataExported"));
        } catch {
            toast.error(t("users_exportFailed"));
        } finally {
            setExportingData(false);
        }
    };

    const handleDeleteUser = async () => {
        setDeleteError("");
        setDeletingAccount(true);
        try {
            const res = await fetch(`/api/v1/users/${userId}/delete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    confirmUsername: deleteConfirmUsername,
                    reason: deleteReason || undefined,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setDeleteError(errorMessage(data, t("users_deleteFailed"), t));
                return;
            }
            toast.success(t("users_deleted"));
            setDeleteModalOpen(false);
            window.location.reload();
        } catch {
            setDeleteError(t("users_somethingWrong"));
        } finally {
            setDeletingAccount(false);
        }
    };

    // Escape, the Tab trap and returning focus to the button that opened it.
    // A delete already in flight is not interruptible, so Escape does nothing
    // until it finishes.
    const deleteDialogRef = useModalDialog<HTMLDivElement>(deleteModalOpen, () => {
        if (!deletingAccount) setDeleteModalOpen(false);
    });

    useEffect(() => {
        let cancelled = false;
        setLoadFailed(false);
        Promise.all([
            // A 500 here used to resolve, leave `user` null, and put the
            // screen on "user not found" - the one answer that tells the
            // operator to stop looking.
            fetch(`/api/v1/users/${userId}`).then((r) => {
                if (!r.ok && r.status !== 404) throw new Error("load failed");
                return r.json();
            }),
            fetch("/api/v1/roles").then((r) => r.json()),
        ]).then(([userData, rolesData]) => {
            if (cancelled) return;
            if (userData.user) {
                setUser(userData.user);
                setForm({
                    username: userData.user.username,
                    email: userData.user.email,
                    roleId: userData.user.role?.id || "",
                });
            }
            setRoles(rolesData.roles || []);
            setLoading(false);
        }).catch(() => {
            if (cancelled) return;
            setLoadFailed(true);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [userId, reloadKey]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        setSaved(false);

        try {
            const res = await fetch(`/api/v1/users/${userId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });

            if (!res.ok) {
                const data = await res.json();
                setError(errorMessage(data, t("users_somethingWrong"), t));
                return;
            }

            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch {
            setError(t("users_somethingWrong"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (loadFailed) {
        return <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />;
    }

    if (!user) {
        return (
            <div className="text-center py-12">
                <p className="text-muted-foreground">{t("users_notFound")}</p>
                <Link href="/admin/users" className={buttonClassName("outline", "default", "mt-4")}>{t("users_backToUsers")}</Link>
            </div>
        );
    }

    return (
        <>
            <AdminPageHeader
                backHref="/admin/users"
                backLabel={t("users_backToList")}
                title={user.username}
                description={user.email}
                actions={
                    <MemberAvatar name={user.username} src={user.avatar} size={48} />
                }
            />

            <div className="grid lg:grid-cols-3 gap-8">
                {/* Edit Form */}
                <div className="lg:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("users_details")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {error && (
                                <div role="alert" className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg">{error}</div>
                            )}
                            <form onSubmit={handleSave} className="space-y-4">
                                <div>
                                    <Label htmlFor={usernameId}>{t("users_username")}</Label>
                                    <Input
                                        id={usernameId}
                                        value={form.username}
                                        onChange={(e) => setForm({ ...form, username: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <Label htmlFor={emailFieldId}>{t("users_email")}</Label>
                                    <Input
                                        id={emailFieldId}
                                        type="email"
                                        value={form.email}
                                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <Label htmlFor={roleFieldId}>{t("users_role")}</Label>
                                    <NativeSelect
                                        id={roleFieldId}
                                        value={form.roleId}
                                        onChange={(e) => setForm({ ...form, roleId: e.target.value })} className="w-full"
                                    >
                                        <option value="">{t("users_noRole")}</option>
                                        {roles.map((role) => (
                                            <option key={role.id} value={role.id}>{role.displayName}</option>
                                        ))}
                                    </NativeSelect>
                                </div>
                                <Button type="submit" disabled={saving}>
                                    {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("users_saving")}</> :
                                     saved ? <><Check className="w-4 h-4" /> {t("users_saved")}</> : t("common_save")}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                </div>

                {/* Info Sidebar */}
                <div className="space-y-6">
                    {(() => {
                        const counts = user._count || {};
                        const statItems = Object.entries(counts)
                            .filter(([, v]) => (v as number) > 0)
                            .map(([key, value]) => ({
                                label: key.charAt(0).toUpperCase() + key.slice(1),
                                value,
                            }));
                        if (statItems.length === 0) return null;
                        return (
                            <Card>
                                <CardHeader>
                                    <CardTitle>{t("users_activity")}</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    {statItems.map((stat) => (
                                        <div key={stat.label} className="flex items-center justify-between">
                                            <span className="text-sm text-muted-foreground">
                                                {stat.label}
                                            </span>
                                            <span className="font-medium">{stat.value}</span>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        );
                    })()}

                    <Card>
                        <CardHeader>
                            <CardTitle>{t("users_info")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("users_locale")}</span>
                                <span>{user.locale}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("users_currency")}</span>
                                <span>{user.currency}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("users_joined")}</span>
                                <span>{formatDate(new Date(user.createdAt), undefined, dateTag)}</span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Ban/Unban */}
                    <Card className={user.isBanned ? "border-destructive/30" : ""}>
                        <CardHeader>
                            <CardTitle>{user.isBanned ? t("users_banned") : t("users_accountActive")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {user.isBanned ? (
                                <div>
                                    {user.banReason && (
                                        <p className="text-sm text-muted-foreground mb-2">{t("users_reason")}: {user.banReason}</p>
                                    )}
                                    {user.bannedAt && (
                                        <p className="text-xs text-muted-foreground mb-3">{t("users_since")}: {formatDate(new Date(user.bannedAt), undefined, dateTag)}</p>
                                    )}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                            const res = await fetch(`/api/v1/users/${userId}`, {
                                                method: "PATCH",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify({ isBanned: false }),
                                            });
                                            const failed = await writeError(res, t("common_writeFailed"), t);
                                            if (failed) { toast.error(failed); return; }
                                            window.location.reload();
                                        }}
                                    >
                                        <ShieldCheck className="w-3 h-3" /> {t("users_unbanUser")}
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={async () => {
                                        const reason = await ask({
                                            title: t("users_banUser"),
                                            message: t("users_banReasonLabel"),
                                            placeholder: t("users_banReasonPlaceholder"),
                                        });
                                        if (reason === null) return;
                                        const res = await fetch(`/api/v1/users/${userId}`, {
                                            method: "PATCH",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ isBanned: true, banReason: reason || undefined }),
                                        });
                                        const failed = await writeError(res, t("common_writeFailed"), t);
                                        if (failed) { toast.error(failed); return; }
                                        window.location.reload();
                                    }}
                                >
                                    <Ban className="w-3 h-3" /> {t("users_banUser")}
                                </Button>
                            )}
                        </CardContent>
                    </Card>

                    {canImpersonate && (
                        <Card>
                            <CardHeader>
                                <CardTitle>{t("users_impersonate")}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <p className="text-xs text-muted-foreground">
                                    {t("users_impersonateDesc")}
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full"
                                    onClick={handleImpersonate}
                                    disabled={impersonating || user.isBanned}
                                >
                                    {impersonating ? (
                                        <>
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            {t("users_switching")}
                                        </>
                                    ) : (
                                        <>
                                            <UserCog className="w-3 h-3" />
                                            {t("users_loginAsUser")}
                                        </>
                                    )}
                                </Button>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader>
                            <CardTitle>GDPR</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={handleExportUserData}
                                disabled={exportingData}
                            >
                                {exportingData ? (
                                    <>
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        {t("users_preparing")}
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-3 h-3" />
                                        {t("users_exportData")}
                                    </>
                                )}
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                className="w-full"
                                onClick={() => {
                                    setDeleteConfirmUsername("");
                                    setDeleteReason("");
                                    setDeleteError("");
                                    setDeleteModalOpen(true);
                                }}
                            >
                                <Trash2 className="w-3 h-3" />
                                {t("users_deleteAccount")}
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Everything installed knows something about this member. The
                page above is core's own columns; this is the rest of the
                site answering, and it loads on its own so a slow module
                delays a panel rather than the screen. */}
            <div className="mt-8">
                <CustomerView userId={user.id} />
            </div>

            {deleteModalOpen && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center"
                    role="presentation"
                >
                    <div
                        className="fixed inset-0 bg-black/50"
                        onClick={() => !deletingAccount && setDeleteModalOpen(false)}
                        aria-hidden="true"
                    />
                    <div
                        ref={deleteDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="admin-delete-title"
                        className="relative bg-card border border-[var(--blysis-color-border)] rounded-xl shadow-2xl p-6 w-full max-w-md mx-4"
                    >
                        <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                                <AlertTriangle className="w-5 h-5 text-destructive" aria-hidden="true" />
                            </div>
                            <div>
                                <h2
                                    id="admin-delete-title"
                                    className="font-semibold text-foreground"
                                >
                                    {t("users_deleteTitle", { username: user.username })}
                                </h2>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t("users_deleteDesc")}
                                </p>
                            </div>
                        </div>

                        {deleteError && (
                            <div role="alert" className="mb-3 p-3 bg-destructive/10 border border-destructive/25 text-destructive text-sm rounded-lg">
                                {deleteError}
                            </div>
                        )}

                        <div className="space-y-3">
                            <div>
                                <Label htmlFor={deleteConfirmUsernameId}>
                                    {t.rich("users_deleteTypeToConfirm", {
                                        username: user.username,
                                        name: (chunks) => (
                                            <span className="font-mono text-destructive">{chunks}</span>
                                        ),
                                    })}
                                </Label>
                                <Input
                                    id={deleteConfirmUsernameId}
                                    value={deleteConfirmUsername}
                                    onChange={(e) =>
                                        setDeleteConfirmUsername(e.target.value)
                                    }
                                    placeholder={user.username}
                                />
                            </div>
                            <div>
                                <Label htmlFor={deleteReasonId}>{t("users_reasonOptional")}</Label>
                                <Input
                                    id={deleteReasonId}
                                    value={deleteReason}
                                    onChange={(e) => setDeleteReason(e.target.value)}
                                    placeholder={t("users_reasonPlaceholder")}
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-6">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDeleteModalOpen(false)}
                                disabled={deletingAccount}
                            >
                                {t("users_cancel")}
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={handleDeleteUser}
                                disabled={
                                    deletingAccount ||
                                    deleteConfirmUsername !== user.username
                                }
                            >
                                {deletingAccount ? (
                                    <>
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        {t("users_deleting")}
                                    </>
                                ) : (
                                    t("users_deleteAccount")
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
