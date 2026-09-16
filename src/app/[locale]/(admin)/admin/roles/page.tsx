"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button, buttonClassName } from "@/core/components/ui/button";
import { Pagination, usePagedRows } from "@/core/components/ui/pagination";
import { Loader2, Plus, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { Link } from "@/core/lib/i18n/navigation";
import { writeError } from "@/core/lib/write-result";
import { LoadFailed } from "@/core/components/ui/load-failed";
import type { RoleRecord } from "./role-form";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { RoleBadge } from "@/core/components/ui/RoleBadge";
import { RoleName } from "@/core/components/ui/RoleName";

type Role = RoleRecord;

export default function AdminRolesPage() {
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const [roles, setRoles] = useState<Role[]>([]);
    const paged = usePagedRows(roles);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const { confirm } = useConfirm();

    const fetchRoles = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/v1/roles");
            if (!res.ok) throw new Error("failed");
            const data = await res.json();
            setRoles(data.roles || []);
            setFailed(false);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRoles();
    }, []);

    const deleteRole = async (roleId: string) => {
        const ok = await confirm({ title: t("roles_deleteTitle"), message: t("roles_deleteMessage"), variant: "danger", confirmText: t("common_delete") });
        if (!ok) return;

        try {
            const res = await fetch(`/api/v1/roles/${roleId}`, { method: "DELETE" });
            const failedMessage = await writeError(res, commonT("somethingWentWrong"), t);
            if (failedMessage) {
                toast.error(failedMessage);
                return;
            }
            fetchRoles();
        } catch {
            toast.error(t("roles_deleteFailed"));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (failed) return <LoadFailed onRetry={fetchRoles} />;

    return (
        <>
            <AdminPageHeader
                title={t("roles_title")}
                description={t("roles_subtitle")}
                actions={<>
                    <Link href="/admin/roles/new" className={buttonClassName("default", "default")}>
                            <Plus className="w-4 h-4" /> {t("roles_newRole")}
                        </Link>
                </>}
            />

            {/* Roles List */}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {paged.rows.map((role) => (
                    <Card key={role.id} className="relative">
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                {/* Drawn the way the site draws it, so an
                                    operator sees what they wrote rather than a
                                    swatch of the colour underneath it. */}
                                <div className="flex items-center gap-2">
                                    <Shield className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                                    <RoleName name={role.displayName} role={role} />
                                    <RoleBadge role={role} />
                                </div>
                                <div className="flex gap-1">
                                    <Link href={`/admin/roles/${role.id}/edit`} className={buttonClassName("ghost", "sm")}>
                                            {t("crud_edit")}
                                        </Link>
                                    {role.name !== "admin" && role.name !== "member" && (
                                        <Button
                                            aria-label={commonT("delete")}
                                            variant="ghost"
                                            size="sm"
                                            className="text-destructive"
                                            onClick={() => deleteRole(role.id)}
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </Button>
                                    )}
                                </div>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">{t("roles_internalName")}</span>
                                    <code className="bg-muted px-2 py-0.5 rounded text-xs">{role.name}</code>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">{t("roles_users")}</span>
                                    <span>{role._count.users}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">{t("roles_priority")}</span>
                                    <span>{role.priority}</span>
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground mb-1">{t("roles_permissions")}</p>
                                    {/*
                                      * A count, not the names. An installation
                                      * with ninety modules offers a hundred and
                                      * three permissions, and a role that holds
                                      * forty of them drew forty chips here -
                                      * which told an operator scanning the list
                                      * nothing they could act on. The names are
                                      * one click away, worded, on the role's own
                                      * screen.
                                      */}
                                    {role.name === "admin" ? (
                                        <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">{t("roles_allPermissions")}</span>
                                    ) : role.rolePermissions.length === 0 ? (
                                        <span className="text-xs text-muted-foreground">{t("roles_noPermissions")}</span>
                                    ) : (
                                        <div className="flex flex-wrap gap-2 text-xs">
                                            <span className="bg-success/10 text-success px-2 py-0.5 rounded">
                                                {t("roles_grantedCount", {
                                                    count: role.rolePermissions.filter((p) => p.state === "ALLOW").length,
                                                })}
                                            </span>
                                            {role.rolePermissions.some((p) => p.state === "NEVER") && (
                                                <span className="bg-destructive/10 text-destructive px-2 py-0.5 rounded">
                                                    {t("roles_refusedCount", {
                                                        count: role.rolePermissions.filter((p) => p.state === "NEVER").length,
                                                    })}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
            <Pagination
                page={paged.page}
                pages={paged.pages}
                total={paged.total}
                onPageChange={paged.setPage}
                className="border-t-0"
            />
        </>
    );
}
