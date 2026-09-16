"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button, buttonClassName } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { Link, useRouter } from "@/core/lib/i18n/navigation";
import { writeError } from "@/core/lib/write-result";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { PermissionMatrix, type PermissionSection, type PermissionState } from "@/core/components/admin/PermissionMatrix";
import { cn } from "@/core/lib/utils";
import { Textarea } from "@/core/components/ui/textarea";
import { RoleBadge } from "@/core/components/ui/RoleBadge";
import { RoleName } from "@/core/components/ui/RoleName";

/**
 * The role editor, on its own route.
 *
 * It used to be a card that unfolded above the list. On a site with two
 * hundred roles that means the thing you came to edit is pushed off the
 * screen, the browser's back button does not close it, and the URL of a role
 * you are halfway through configuring cannot be sent to anyone. A create or
 * edit screen is a place, so it gets an address: /admin/roles/new and
 * /admin/roles/<id>/edit.
 *
 * Both routes render this component. `role` decides which of the two it is.
 */

export interface RolePermission {
    permission: string;
    state: PermissionState;
}

export interface RoleRecord {
    id: string;
    name: string;
    displayName: string;
    color: string | null;
    priority: number;
    isDefault: boolean;
    /** Declarations an operator wrote, for the name and for the pill. */
    nameCss?: string | null;
    badgeCss?: string | null;
    rolePermissions: RolePermission[];
    _count: { users: number };
}

/**
 * The vocabulary arrives already worded and already grouped.
 *
 * A module's label lives in that module's own translations, so resolving it
 * here would mean loading ninety namespaces into this screen and core knowing
 * which ones. The server does it and sends sentences.
 */

export function RoleForm({ role }: { role?: RoleRecord }) {
    const t = useTranslations("admin");
    const locale = useLocale();
    const { data: session } = useSession();
    const commonT = useTranslations("common");
    const router = useRouter();

    const [sections, setSections] = useState<PermissionSection[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({
        name: role?.name ?? "",
        displayName: role?.displayName ?? "",
        color: role?.color ?? "#6366f1",
        priority: role?.priority ?? 0,
        permissions: Object.fromEntries(
            (role?.rolePermissions ?? []).map((entry) => [entry.permission, entry.state]),
        ) as Record<string, PermissionState>,
        nameCss: role?.nameCss ?? "",
        badgeCss: role?.badgeCss ?? "",
    });

    const isAdminRole = role?.name === "admin";

    useEffect(() => {
        // The language can change while a catalogue is in flight, and an
        // answer in the old one must not land under the new one.
        let current = true;
        fetch(`/api/v1/admin/permission-catalogue?locale=${locale}`)
            .then((response) => response.json())
            .then((data) => { if (current) setSections(data.sections ?? []); })
            .catch(() => { /* the form still saves; the grid stays empty */ });
        return () => { current = false; };
    }, [locale]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(role ? `/api/v1/roles/${role.id}` : "/api/v1/roles", {
                method: role ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...form,
                    // The role's whole opinion, sent as a list. A name that is
                    // not here is the third state - nothing at all - which is
                    // why the endpoint replaces rather than merges.
                    permissions: Object.entries(form.permissions).map(([name, state]) => ({ name, state })),
                    // Empty means "no rule", which is a null column rather
                    // than an empty string nothing would ever match.
                    nameCss: form.nameCss.trim() || null,
                    badgeCss: form.badgeCss.trim() || null,
                }),
            });
            const failed = await writeError(res, commonT("somethingWentWrong"), t);
            if (failed) {
                setError(failed);
                return;
            }
            toast.success(role ? t("roles_saved") : t("roles_created"));
            router.push("/admin/roles");
            router.refresh();
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <AdminPageHeader
                title={role ? t("roles_editRole", { name: role.displayName }) : t("roles_newRole")}
                description={t("roles_subtitle")}
                onBack={() => router.push("/admin/roles")}
                backLabel={commonT("back")}
            />

            {error && (
                <div role="alert" className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
            )}

            <Card>
                <CardContent className="p-6">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="role-name">{t("roles_internalName")} *</Label>
                                <Input
                                    id="role-name"
                                    value={form.name}
                                    onChange={(e) =>
                                        setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z_]/g, "") })
                                    }
                                    placeholder="moderator"
                                    required
                                    disabled={isAdminRole}
                                />
                                <p className="text-xs text-muted-foreground mt-1">{t("roles_lowercaseHint")}</p>
                            </div>
                            <div>
                                <Label htmlFor="role-display-name">{t("roles_displayName")} *</Label>
                                <Input
                                    id="role-display-name"
                                    value={form.displayName}
                                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                                    placeholder={t("roles_namePlaceholder")}
                                    required
                                />
                            </div>
                            <div>
                                <Label htmlFor="role-color">{t("roles_color")}</Label>
                                <div className="flex gap-2">
                                    <input
                                        id="role-color"
                                        aria-label={t("roles_color")}
                                        type="color"
                                        value={form.color}
                                        onChange={(e) => setForm({ ...form, color: e.target.value })}
                                        className="w-11 h-11 rounded-lg border border-border cursor-pointer"
                                    />
                                    <Input
                                        value={form.color}
                                        onChange={(e) => setForm({ ...form, color: e.target.value })}
                                        placeholder="#6366f1"
                                        aria-label={t("roles_color")}
                                    />
                                </div>
                            </div>
                            <div>
                                <Label htmlFor="role-priority">{t("roles_priority")}</Label>
                                <Input
                                    id="role-priority"
                                    type="number"
                                    value={form.priority}
                                    onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                                    placeholder="0"
                                />
                                <p className="text-xs text-muted-foreground mt-1">{t("roles_priorityHint")}</p>
                            </div>
                        </div>

                        {/* Declarations rather than a colour, because that is
                            what an operator actually wants: a gradient with
                            `background-clip`, an animation with a keyframe.
                            None of it survives being flattened into a style
                            attribute, so the site writes a rule instead - and
                            `safeRoleCss` decides what may go in one, here and
                            again at every render site. */}
                        <div className="grid md:grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="role-name-css">{t("roles_nameCss")}</Label>
                                <Textarea
                                    id="role-name-css"
                                    rows={3}
                                    value={form.nameCss}
                                    placeholder={t("roles_cssPlaceholder")}
                                    onChange={(e) => setForm({ ...form, nameCss: e.target.value })}
                                />
                                <p className="text-xs text-muted-foreground mt-1">{t("roles_cssHint")}</p>
                            </div>
                            <div>
                                <Label htmlFor="role-badge-css">{t("roles_badgeCss")}</Label>
                                <Textarea
                                    id="role-badge-css"
                                    rows={3}
                                    value={form.badgeCss}
                                    placeholder={t("roles_cssPlaceholder")}
                                    onChange={(e) => setForm({ ...form, badgeCss: e.target.value })}
                                />
                                <p className="text-xs text-muted-foreground mt-1">{t("roles_badgeCssHint")}</p>
                            </div>
                        </div>

                        {/* Drawn the way the site will draw it. A rule that is
                            refused shows the plain name here too, which is the
                            only warning an operator gets before saving.

                            Two different things are being previewed, so two
                            different words. `nameCss` paints a *member's name*,
                            so the preview uses the reader's own - watching your
                            own name take the styling is the question an
                            operator is actually asking. `badgeCss` paints the
                            *role*, so the pill shows what is being typed into
                            the display name field. It used to show the same
                            placeholder in both places, which previewed
                            nothing. */}
                        <div className="flex items-center gap-3 border border-border rounded-lg p-3">
                            <span className="text-xs text-muted-foreground">{t("roles_preview")}</span>
                            <RoleName
                                name={session?.user?.name || t("roles_previewName")}
                                role={{ id: "preview", displayName: form.displayName, color: form.color, nameCss: form.nameCss }}
                            />
                            <RoleBadge
                                role={{ id: "preview", name: form.displayName || t("roles_previewRole"), displayName: form.displayName, color: form.color, badgeCss: form.badgeCss }}
                            />
                        </div>

                        <div>
                            <Label className="mb-3 block">{t("roles_permissions")}</Label>
                            {isAdminRole ? (
                                <p className="text-sm text-muted-foreground">{t("roles_adminAllPerms")}</p>
                            ) : (
                                <PermissionMatrix
                                    sections={sections}
                                    value={form.permissions}
                                    onChange={(permissions) => setForm((prev) => ({ ...prev, permissions }))}
                                    disabled={saving}
                                />
                            )}
                        </div>

                        <div className="flex gap-2">
                            <Button type="submit" disabled={saving}>
                                {saving ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" /> {t("roles_saving")}
                                    </>
                                ) : role ? (
                                    t("roles_saveChanges")
                                ) : (
                                    t("roles_createRole")
                                )}
                            </Button>
                            <Link href="/admin/roles" className={cn(buttonClassName("outline", "default"), saving && "pointer-events-none opacity-50")} aria-disabled={saving} tabIndex={saving ? -1 : undefined}>
                                    {commonT("cancel")}
                                </Link>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </>
    );
}
