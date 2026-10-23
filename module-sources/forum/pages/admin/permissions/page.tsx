"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, LoadFailed } from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";
import { clearedMatrix, normalisedMatrix, writeError, type MatrixRule } from "@/core/sdk";

/**
 * Who may read, write and reply in each category.
 *
 * The two silences this screen has to make visible are the whole difficulty of
 * the feature. A category with no rules is open to everybody, and a category
 * with rules is shut to every role the rules do not name. Those are opposite
 * answers to what looks like the same empty grid, so the screen says which one
 * it is in words above the table, and gives removing the rules its own control
 * rather than letting an operator arrive there by unticking.
 *
 * Reading is through this module's own admin endpoint, not the board's. The
 * board narrows categories to what the reader may see, and an admin who has
 * just unticked their own role would otherwise lose the row they need to
 * untick back.
 */

interface Category {
    id: string;
    name: string;
    parentId: string | null;
    isActive: boolean;
}

interface Role {
    id: string;
    name: string;
    displayName: string | null;
}

interface StoredRule extends MatrixRule {
    categoryId: string;
}

/** Depth in the tree, so a child reads as a child. Bounded like the server's. */
function depthOf(category: Category, byId: Map<string, Category>): number {
    let depth = 0;
    let at = category.parentId ? byId.get(category.parentId) : undefined;
    while (at && depth < 20) {
        depth += 1;
        at = at.parentId ? byId.get(at.parentId) : undefined;
    }
    return depth;
}

export default function ForumPermissionsPage() {
    const t = useTranslations("forum");
    const commonT = useTranslations("common");

    const [categories, setCategories] = useState<Category[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [rules, setRules] = useState<StoredRule[]>([]);
    const [openId, setOpenId] = useState<string | null>(null);
    const [draft, setDraft] = useState<MatrixRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const res = await fetch("/api/v1/forum/categories/permissions");
            if (!res.ok) throw new Error("read");
            const body = await res.json();
            setCategories(body.categories ?? []);
            setRoles(body.roles ?? []);
            setRules(body.rules ?? []);
            setOpenId((current) => current ?? body.categories?.[0]?.id ?? null);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    // The grid follows the category. A row per role every time, so the boxes
    // are the whole answer rather than a diff against what is stored.
    useEffect(() => {
        if (!openId) return;
        const stored = rules.filter((rule) => rule.categoryId === openId);
        setDraft(roles.map((role) => {
            const found = stored.find((rule) => rule.roleId === role.id);
            return {
                roleId: role.id,
                canView: found?.canView ?? false,
                canPost: found?.canPost ?? false,
                canReply: found?.canReply ?? false,
            };
        }));
    }, [openId, roles, rules]);

    const byId = new Map(categories.map((category) => [category.id, category]));
    const hasRules = rules.some((rule) => rule.categoryId === openId);

    const send = async (payload: MatrixRule[], message: string) => {
        if (!openId) return;
        setSaving(true);
        try {
            const res = await fetch("/api/v1/forum/categories/permissions", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ categoryId: openId, rules: payload }),
            });
            const wrong = await writeError(res, t("adm_permSaveFailed"), t);
            if (wrong) {
                toast.error(wrong);
                return;
            }
            toast.success(message);
            await load();
        } catch {
            toast.error(t("adm_permSaveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const tick = (roleId: string, field: "canView" | "canPost" | "canReply", on: boolean) => {
        setDraft(draft.map((rule) => {
            if (rule.roleId !== roleId) return rule;
            const next = { ...rule, [field]: on };
            // Unticking "may open" takes the other two with it, because the
            // site reads "may post, may not open" as nothing at all and an
            // operator should see that happen rather than be told later.
            if (field === "canView" && !on) return { ...next, canPost: false, canReply: false };
            if (field !== "canView" && on) return { ...next, canView: true };
            return next;
        }));
    };

    if (loading) {
        return <Card><CardContent className="py-10 text-center text-muted-foreground">{commonT("loading")}</CardContent></Card>;
    }
    if (failed) {
        return (
            <>
                <AdminPageHeader title={t("adm_permTitle")} description={t("adm_permSubtitle")} />
                <Card><CardContent><LoadFailed onRetry={load} /></CardContent></Card>
            </>
        );
    }

    return (
        <>
            <AdminPageHeader title={t("adm_permTitle")} description={t("adm_permSubtitle")} />

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <Card className="lg:col-span-1">
                    <CardHeader><CardTitle>{t("adm_permCategories")}</CardTitle></CardHeader>
                    <CardContent className="p-2">
                        {categories.length === 0 ? (
                            <p className="text-sm text-muted-foreground p-2">{t("adm_permNoCategories")}</p>
                        ) : (
                            <ul>
                                {categories.map((category) => (
                                    <li key={category.id}>
                                        <button
                                            type="button"
                                            onClick={() => setOpenId(category.id)}
                                            aria-current={category.id === openId}
                                            className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 ${
                                                category.id === openId ? "bg-muted font-medium" : "hover:bg-muted/50"
                                            }`}
                                            // Tailwind cannot express a depth
                                            // it only learns at render time.
                                            style={{ paddingLeft: `${0.75 + depthOf(category, byId)}rem` }}
                                        >
                                            <span className="truncate">{category.name}</span>
                                            {!category.isActive && (
                                                <span className="text-xs text-muted-foreground shrink-0">
                                                    {t("adm_permInactive")}
                                                </span>
                                            )}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                <Card className="lg:col-span-3">
                    <CardHeader>
                        <CardTitle>{byId.get(openId ?? "")?.name ?? t("adm_permTitle")}</CardTitle>
                        {/* The sentence that tells the two silences apart. */}
                        <p className="text-sm text-muted-foreground">
                            {hasRules ? t("adm_permRuled") : t("adm_permUnruled")}
                        </p>
                    </CardHeader>
                    <CardContent>
                        {roles.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t("adm_permNoRoles")}</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">{t("adm_permRole")}</th>
                                            <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t("adm_permView")}</th>
                                            <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t("adm_permPost")}</th>
                                            <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t("adm_permReply")}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {draft.map((rule) => {
                                            const role = roles.find((r) => r.id === rule.roleId);
                                            const name = role?.displayName || role?.name || rule.roleId;
                                            return (
                                                <tr key={rule.roleId} className="border-b last:border-0">
                                                    <td className="py-2 pr-4">{name}</td>
                                                    {(["canView", "canPost", "canReply"] as const).map((field) => (
                                                        <td key={field} className="py-2 px-3">
                                                            <Checkbox
                                                                checked={rule[field]}
                                                                aria-label={`${name} - ${t(`adm_perm${field === "canView" ? "View" : field === "canPost" ? "Post" : "Reply"}`)}`}
                                                                onChange={(event) => tick(rule.roleId, field, event.target.checked)}
                                                            />
                                                        </td>
                                                    ))}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        <div className="flex justify-between gap-2 mt-6 flex-wrap">
                            <Button
                                variant="outline"
                                disabled={saving || !hasRules}
                                onClick={() => send(clearedMatrix(), t("adm_permCleared"))}
                            >
                                {t("adm_permClear")}
                            </Button>
                            <Button
                                disabled={saving || !openId || roles.length === 0}
                                onClick={() => send(normalisedMatrix(draft), t("adm_permSaved"))}
                            >
                                {t("adm_permSave")}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </>
    );
}
