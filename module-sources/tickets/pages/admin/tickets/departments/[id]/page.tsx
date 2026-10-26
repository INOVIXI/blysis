"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { clearedMatrix, normalisedMatrix, writeError, type MatrixRule } from "@/core/sdk";
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Checkbox,
    Input,
    Label,
    LoadFailed,
    NativeSelect,
} from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";

/**
 * One department: the extra questions it asks, and who may write to it.
 *
 * Both on one screen because they are one decision about one queue, and an
 * operator setting up a billing department is thinking about both at once.
 *
 * The permission half repeats nothing: the rows it sends come from the SDK's
 * `normalisedMatrix`, the same function the forum's grid uses, so unticking
 * every role shuts the department here exactly as it shuts a category there.
 * Removing the rules is its own control, because that is the one thing that
 * opens the department to everybody and it should never be somewhere an
 * operator arrives by unticking.
 */

interface FieldDraft {
    key: string;
    label: string;
    type: "text" | "select";
    required: boolean;
    options: string;
}

interface Role {
    id: string;
    name: string;
    displayName: string | null;
}

const REFUSALS: Record<string, string> = {
    field_bad_key: "adm_errBadKey",
    field_no_label: "adm_errNoLabel",
    field_repeated_key: "adm_errRepeatedKey",
    field_select_without_options: "adm_errSelectWithoutOptions",
    field_repeated_option: "adm_errRepeatedOption",
};

export default function DepartmentSetupPage() {
    const t = useTranslations("tickets");
    const commonT = useTranslations("common");
    // A module page is served through core's catch-all, so `useParams` hands
    // back the whole path under `slug` rather than this route's own `[id]`.
    // Reading `params.id` gave undefined and the screen sat on its spinner.
    const routed = useParams()?.slug;
    const segments = Array.isArray(routed) ? routed : typeof routed === "string" ? routed.split("/") : [];
    const id = segments[segments.length - 1] ?? "";

    const [name, setName] = useState("");
    const [fields, setFields] = useState<FieldDraft[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [matrix, setMatrix] = useState<MatrixRule[]>([]);
    const [hasRules, setHasRules] = useState(false);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        setFailed(false);
        try {
            const res = await fetch(`/api/v1/tickets/departments/${id}/setup`);
            if (!res.ok) throw new Error("read");
            const body = await res.json();
            setName(body.department?.name ?? "");
            setFields((body.fields ?? []).map((field: { key: string; label: string; type: string; required: boolean; options: string[] }) => ({
                key: field.key,
                label: field.label,
                type: field.type === "select" ? "select" : "text",
                required: field.required,
                options: (field.options ?? []).join(", "),
            })));
            setRoles(body.roles ?? []);
            const stored: { roleId: string; canView: boolean; canPost: boolean; canReply: boolean }[] = body.permissions ?? [];
            setHasRules(stored.length > 0);
            setMatrix((body.roles ?? []).map((role: Role) => {
                const found = stored.find((rule) => rule.roleId === role.id);
                return {
                    roleId: role.id,
                    canView: found?.canView ?? false,
                    canPost: found?.canPost ?? false,
                    canReply: found?.canReply ?? false,
                };
            }));
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { void load(); }, [load]);

    const send = async (permissions: MatrixRule[] | undefined, message: string) => {
        setSaving(true);
        try {
            const res = await fetch(`/api/v1/tickets/departments/${id}/setup`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fields: fields.map((field) => ({
                        key: field.key.trim(),
                        label: field.label.trim(),
                        type: field.type,
                        required: field.required,
                        options: field.options.split(",").map((option) => option.trim()).filter(Boolean),
                    })),
                    permissions,
                }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                const key = typeof body?.code === "string" ? REFUSALS[body.code] : undefined;
                toast.error(key ? t(key, { key: body?.key ?? "" }) : t("adm_setupSaveFailed"));
                return;
            }
            toast.success(message);
            await load();
        } catch {
            toast.error(t("adm_setupSaveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const tick = (roleId: string, field: "canView" | "canPost" | "canReply", on: boolean) => {
        setMatrix(matrix.map((rule) => {
            if (rule.roleId !== roleId) return rule;
            const next = { ...rule, [field]: on };
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
                <AdminPageHeader title={t("adm_setupTitle")} description={t("adm_setupSubtitle")} />
                <Card><CardContent><LoadFailed onRetry={load} /></CardContent></Card>
            </>
        );
    }

    return (
        <>
            <AdminPageHeader
                title={name || t("adm_setupTitle")}
                description={t("adm_setupSubtitle")}
                backHref="/admin/tickets/departments"
                backLabel={commonT("back")}
                actions={
                    <Button disabled={saving} onClick={() => send(normalisedMatrix(matrix), t("adm_setupSaved"))}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
                        {t("adm_setupSave")}
                    </Button>
                }
            />

            <Card className="mb-6">
                <CardHeader>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <CardTitle>{t("adm_questions")}</CardTitle>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setFields([...fields, { key: "", label: "", type: "text", required: false, options: "" }])}
                        >
                            <Plus className="w-4 h-4" aria-hidden="true" />
                            {t("adm_addQuestion")}
                        </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">{t("adm_questionsHint")}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                    {fields.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("adm_noQuestions")}</p>
                    ) : fields.map((field, index) => (
                        <div key={index} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                            <div className="sm:col-span-3">
                                <Label htmlFor={`field-key-${index}`}>{t("adm_questionKey")}</Label>
                                <Input
                                    id={`field-key-${index}`}
                                    value={field.key}
                                    placeholder="order_number"
                                    onChange={(e) => setFields(fields.map((f, i) => (i === index ? { ...f, key: e.target.value } : f)))}
                                />
                            </div>
                            <div className="sm:col-span-4">
                                <Label htmlFor={`field-label-${index}`}>{t("adm_questionLabel")}</Label>
                                <Input
                                    id={`field-label-${index}`}
                                    value={field.label}
                                    onChange={(e) => setFields(fields.map((f, i) => (i === index ? { ...f, label: e.target.value } : f)))}
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <Label htmlFor={`field-type-${index}`}>{t("adm_questionType")}</Label>
                                <NativeSelect
                                    id={`field-type-${index}`}
                                    value={field.type}
                                    onChange={(e) => setFields(fields.map((f, i) => (i === index ? { ...f, type: e.target.value as "text" | "select" } : f)))}
                                >
                                    <option value="text">{t("adm_questionText")}</option>
                                    <option value="select">{t("adm_questionSelect")}</option>
                                </NativeSelect>
                            </div>
                            <div className="sm:col-span-2">
                                {field.type === "select" && (
                                    <>
                                        <Label htmlFor={`field-options-${index}`}>{t("adm_questionOptions")}</Label>
                                        <Input
                                            id={`field-options-${index}`}
                                            value={field.options}
                                            placeholder={t("adm_questionOptionsPlaceholder")}
                                            onChange={(e) => setFields(fields.map((f, i) => (i === index ? { ...f, options: e.target.value } : f)))}
                                        />
                                    </>
                                )}
                            </div>
                            <div className="sm:col-span-1 flex items-center gap-2 pb-2">
                                <label className="flex items-center gap-1 text-xs">
                                    <Checkbox
                                        checked={field.required}
                                        aria-label={t("adm_questionRequired")}
                                        onChange={(e) => setFields(fields.map((f, i) => (i === index ? { ...f, required: e.target.checked } : f)))}
                                    />
                                    {t("adm_questionRequired")}
                                </label>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={t("adm_removeQuestion", { label: field.label || field.key })}
                                    onClick={() => setFields(fields.filter((_, i) => i !== index))}
                                >
                                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t("adm_whoMay")}</CardTitle>
                    {/* The sentence that tells the two silences apart. */}
                    <p className="text-sm text-muted-foreground">
                        {hasRules ? t("adm_whoMayRuled") : t("adm_whoMayUnruled")}
                    </p>
                </CardHeader>
                <CardContent>
                    {roles.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("adm_noRoles")}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">{t("adm_role")}</th>
                                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t("adm_maySee")}</th>
                                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t("adm_mayOpen")}</th>
                                        <th className="text-left py-2 px-3 font-medium text-muted-foreground">{t("adm_mayReply")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {matrix.map((rule) => {
                                        const role = roles.find((r) => r.id === rule.roleId);
                                        const label = role?.displayName || role?.name || rule.roleId;
                                        return (
                                            <tr key={rule.roleId} className="border-b last:border-0">
                                                <td className="py-2 pr-4">{label}</td>
                                                {(["canView", "canPost", "canReply"] as const).map((field) => (
                                                    <td key={field} className="py-2 px-3">
                                                        <Checkbox
                                                            checked={rule[field]}
                                                            aria-label={`${label} - ${field}`}
                                                            onChange={(e) => tick(rule.roleId, field, e.target.checked)}
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
                    <div className="flex justify-start mt-6">
                        <Button
                            variant="outline"
                            disabled={saving || !hasRules}
                            onClick={() => send(clearedMatrix(), t("adm_whoMayCleared"))}
                        >
                            {t("adm_whoMayClear")}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </>
    );
}
