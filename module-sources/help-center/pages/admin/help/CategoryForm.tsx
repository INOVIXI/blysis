"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Button, Card, CardContent, CheckboxField, Input, Label, LocalizedTextInput, UrlOrFile,
} from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";
import { joinTranslations, splitTranslations, writeError, type LanguageTexts } from "@/core/sdk";
import { Loader2 } from "lucide-react";
import type { AdminHelpCategory } from "./rows";

/**
 * Writing a section of the help centre, and changing one already written.
 *
 * One form for both, for the same reason the article form is one: the fields
 * are the same fields and a second copy drifts.
 */
export function CategoryForm({
    category,
    onBack,
    onSaved,
}: {
    category: AdminHelpCategory | null;
    onBack: () => void;
    onSaved: () => void;
}) {
    const t = useTranslations("helpCenter");
    const commonT = useTranslations("common");

    const [form, setForm] = useState({
        name: category?.name ?? "",
        description: category?.description ?? "",
        icon: category?.icon ?? "",
        image: category?.image ?? "",
        isActive: category?.isActive ?? true,
    });
    // Each language beside its original in `form`, sent as `translations`.
    const [languages, setLanguages] = useState<Record<"name" | "description", LanguageTexts>>({
        name: category?.translations?.name ?? {},
        description: category?.translations?.description ?? {},
    });
    const word = (field: "name" | "description", next: unknown) => {
        const parts = splitTranslations(next);
        setForm((was) => ({ ...was, [field]: parts.original }));
        setLanguages((was) => ({ ...was, [field]: parts.translations }));
    };
    const [iconMode, setIconMode] = useState<"icon" | "image">(category?.image ? "image" : "icon");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(
                category ? `/api/v1/help/categories/${category.id}` : "/api/v1/help/categories",
                {
                    method: category ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    // Every language every time: an empty one is how a
                    // cleared language goes.
                    body: JSON.stringify({ ...form, translations: languages }),
                },
            );
            const failed = await writeError(
                res,
                category ? t("adm_updateCategoryFailed") : t("adm_createCategoryFailed"),
                t,
            );
            if (failed) {
                setError(failed);
                return;
            }
            toast.success(category ? t("adm_categorySaved") : t("adm_categoryCreated"));
            onSaved();
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <AdminPageHeader
                title={category ? t("adm_editCategory") : t("adm_newHelpCategory")}
                description={t("adm_manageKnowledgeBase")}
                onBack={onBack}
                backLabel={commonT("back")}
            />

            {error && (
                <div role="alert" className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
            )}

            <Card>
                <CardContent className="p-6">
                    <form onSubmit={submit} className="space-y-4">
                        <div>
                            <Label htmlFor="help-category-name">{`${t("adm_name")} *`}</Label>
                            <LocalizedTextInput
                                id="help-category-name"
                                label={t("adm_name")}
                                value={joinTranslations(form.name, languages.name)}
                                onChange={(next) => word("name", next)}
                                maxLength={100}
                                required
                            />
                        </div>
                        <div>
                            <Label htmlFor="help-category-description">{t("adm_description")}</Label>
                            <LocalizedTextInput
                                id="help-category-description"
                                label={t("adm_description")}
                                multiline
                                rows={3}
                                maxLength={500}
                                value={joinTranslations(form.description ?? "", languages.description)}
                                onChange={(next) => word("description", next)}
                            />
                        </div>
                        <div>
                            <Label>{t("adm_icon")}</Label>
                            <div className="flex gap-2 mb-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={iconMode === "icon" ? "default" : "outline"}
                                    onClick={() => setIconMode("icon")}
                                >
                                    {t("adm_lucideIcon")}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={iconMode === "image" ? "default" : "outline"}
                                    onClick={() => setIconMode("image")}
                                >
                                    {t("adm_imageUpload")}
                                </Button>
                            </div>
                            {iconMode === "icon" ? (
                                <Input
                                    value={form.icon ?? ""}
                                    onChange={(e) => setForm({ ...form, icon: e.target.value, image: "" })}
                                    placeholder="HelpCircle, BookOpen, Lightbulb..."
                                    aria-label={t("adm_lucideIcon")}
                                />
                            ) : (
                                <UrlOrFile
                                    value={form.image ?? ""}
                                    onChange={(v) => setForm({ ...form, image: v, icon: "" })}
                                    accept="image/*"
                                />
                            )}
                        </div>
                        <CheckboxField
                            id="help-category-active"
                            checked={form.isActive}
                            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                            label={t("adm_active")}
                        />
                        <Button type="submit" disabled={saving}>
                            {saving
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_creating")}</>
                                : category ? commonT("save") : t("adm_createCategory")}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </>
    );
}
