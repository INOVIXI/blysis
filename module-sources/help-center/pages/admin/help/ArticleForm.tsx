"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Button, Card, CardContent, CheckboxField, Input, Label, NativeSelect, RichTextEditor,
} from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";
import { writeError } from "@/core/sdk";
import { Loader2 } from "lucide-react";
import type { AdminHelpArticle, AdminHelpCategory } from "./rows";

/**
 * Writing an article, and changing one that is already written.
 *
 * One form for both, because they ask for the same five things and a second
 * copy is how the create screen and the edit screen come to disagree about
 * which of them are required. Which it is showing is `article`: absent, it
 * writes a new one; present, it saves onto that one.
 *
 * The address it saves to is the slug the article had when it was opened. A
 * title can be changed without moving the page somebody has already linked
 * to, so the slug is not derived again here.
 */
export function ArticleForm({
    article,
    categories,
    onBack,
    onSaved,
}: {
    article: AdminHelpArticle | null;
    categories: AdminHelpCategory[];
    onBack: () => void;
    onSaved: () => void;
}) {
    const t = useTranslations("helpCenter");
    const commonT = useTranslations("common");

    const [form, setForm] = useState({
        title: article?.title ?? "",
        content: article?.content ?? "",
        categoryId: article?.category?.id ?? "",
        isActive: article?.isActive ?? true,
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(
                article ? `/api/v1/help/articles/${article.slug}` : "/api/v1/help/articles",
                {
                    method: article ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                },
            );
            const failed = await writeError(
                res,
                article ? t("adm_updateArticleFailed") : t("adm_createArticleFailed"),
                t,
            );
            if (failed) {
                setError(failed);
                return;
            }
            toast.success(article ? t("adm_articleSaved") : t("adm_articleCreated"));
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
                title={article ? t("adm_editArticle") : t("adm_newHelpArticle")}
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
                            <Label>{`${t("adm_title")} *`}</Label>
                            <Input
                                aria-label={t("adm_title")}
                                value={form.title}
                                onChange={(e) => setForm({ ...form, title: e.target.value })}
                                required
                            />
                        </div>
                        <div>
                            <Label>{`${t("adm_category")} *`}</Label>
                            {categories.length === 0 ? (
                                <p className="text-sm text-destructive mt-1">{t("adm_noCategoriesYet")}</p>
                            ) : (
                                <NativeSelect
                                    aria-label={t("adm_category")}
                                    value={form.categoryId}
                                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                                    className="w-full"
                                    required
                                >
                                    <option value="">{t("adm_selectCategory")}</option>
                                    {categories.map((cat) => (
                                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                                    ))}
                                </NativeSelect>
                            )}
                        </div>
                        <div>
                            <Label>{`${t("adm_content")} *`}</Label>
                            <RichTextEditor
                                value={form.content}
                                onChange={(value: string) => setForm({ ...form, content: value })}
                            />
                        </div>
                        {/* The list has always drawn a status column. Nothing
                            could set it: an article was created active and
                            stayed active, and the endpoint had taken the field
                            since it was written. */}
                        <CheckboxField
                            id="help-article-active"
                            checked={form.isActive}
                            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                            label={t("adm_active")}
                        />
                        <Button type="submit" disabled={saving}>
                            {saving
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_creating")}</>
                                : article ? commonT("save") : t("adm_createArticle")}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </>
    );
}
