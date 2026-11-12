"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useRouter } from "@/core/sdk/navigation";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, LocalizedTextInput, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, UrlOrFile} from "@/core/sdk/ui";
import { joinTranslations, splitTranslations, writeError, type LanguageTexts } from "@/core/sdk";
import { AdminPageHeader } from "@/core/sdk/admin";


interface Category {
    id: string;
    name: string;
    slug: string;
}

type WordField = "title" | "excerpt" | "content";
const NO_LANGUAGES: Record<WordField, LanguageTexts> = { title: {}, excerpt: {}, content: {} };

export default function NewBlogArticlePage() {
    const t = useTranslations("blog");
    const commonT = useTranslations("common");
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [categories, setCategories] = useState<Category[]>([]);
    // Each language of the title, excerpt and body, beside the originals in
    // the form.
    const [languages, setLanguages] = useState<Record<WordField, LanguageTexts>>(NO_LANGUAGES);
    const [formData, setFormData] = useState({
        title: "",
        excerpt: "",
        content: "",
        coverImage: "",
        status: "DRAFT",
        categoryId: "",
        tags: "",
    });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Fetch categories
        fetch("/api/v1/blog/categories")
            .then(res => res.json())
            .then(data => setCategories(data))
            .catch(console.error);
    }, []);

    // The original goes to the form's column, each language beside it.
    const word = (field: WordField, next: unknown) => {
        const parts = splitTranslations(next);
        setFormData((was) => ({ ...was, [field]: parts.original }));
        setLanguages((was) => ({ ...was, [field]: parts.translations }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const res = await fetch("/api/v1/blog/articles", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...formData,
                    translations: languages,
                    categoryId: formData.categoryId || null,
                    tags: formData.tags ? formData.tags.split(",").map(t => t.trim()) : [],
                    publishedAt: formData.status === "PUBLISHED" ? new Date().toISOString() : null,
                }),
            });

            const failed = await writeError(res, t("adm_createArticleFailed"), t);
            if (failed) {
                throw new Error(failed);
            }

            router.push("/admin/blog/articles");
            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : commonT("somethingWentWrong"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <AdminPageHeader
                backHref="/admin/blog/articles"
                backLabel={t("adm_backToArticles")}
                title={t("adm_newArticle")}
                description={t("adm_createBlogArticle")}
            />

            {error && (
                <div role="alert" className="mb-6 p-4 bg-destructive/10 border border-destructive/50 text-destructive rounded-lg">
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content */}
                    <div className="lg:col-span-2 space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>{t("adm_articleContent")}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <Label htmlFor="title">{`${t("adm_titleField")} *`}</Label>
                                    <LocalizedTextInput
                                        id="title"
                                        label={t("adm_titleField")}
                                        value={joinTranslations(formData.title, languages.title)}
                                        onChange={(next) => word("title", next)}
                                        placeholder={t("adm_enterTitle")}
                                        maxLength={200}
                                        required
                                    />
                                </div>

                                <div>
                                    <Label htmlFor="excerpt">{t("adm_excerpt")}</Label>
                                    <LocalizedTextInput
                                        id="excerpt"
                                        label={t("adm_excerpt")}
                                        multiline
                                        rows={3}
                                        maxLength={500}
                                        value={joinTranslations(formData.excerpt, languages.excerpt)}
                                        onChange={(next) => word("excerpt", next)}
                                        placeholder={t("adm_briefSummary")}
                                    />
                                </div>

                                <div>
                                    <Label id="content-label">{`${t("adm_content")} *`}</Label>
                                    <LocalizedTextInput
                                        label={t("adm_content")}
                                        labelledBy="content-label"
                                        rich
                                        value={joinTranslations(formData.content, languages.content)}
                                        onChange={(next) => word("content", next)}
                                        placeholder={t("adm_contentPlaceholder")}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>{t("adm_publishing")}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <Label htmlFor="status">{t("adm_status")}</Label>
                                    <Select
                                        value={formData.status}
                                        onValueChange={(value: string) => setFormData({ ...formData, status: value })}
                                    >
                                        <SelectTrigger id="status">
                                            <SelectValue placeholder={t("adm_selectStatus")} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="DRAFT">{t("adm_draft")}</SelectItem>
                                            <SelectItem value="PUBLISHED">{t("adm_published")}</SelectItem>
                                            <SelectItem value="SCHEDULED">{t("adm_scheduled")}</SelectItem>
                                            <SelectItem value="ARCHIVED">{t("adm_archived")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div>
                                    <Label htmlFor="category">{t("adm_category")}</Label>
                                    <Select
                                        value={formData.categoryId}
                                        onValueChange={(value: string) => setFormData({ ...formData, categoryId: value })}
                                    >
                                        <SelectTrigger id="category">
                                            <SelectValue placeholder={t("adm_selectCategory")} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="">{t("adm_noCategory")}</SelectItem>
                                            {categories.map((cat) => (
                                                <SelectItem key={cat.id} value={cat.id}>
                                                    {cat.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="pt-4">
                                    <Button type="submit" className="w-full" disabled={loading}>
                                        {loading ? t("adm_saving") : t("adm_saveArticle")}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>{t("adm_media")}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <UrlOrFile
                                        id="coverImage"
                                        label={t("adm_coverImage")}
                                        value={formData.coverImage}
                                        onChange={(v) => setFormData({ ...formData, coverImage: v })}
                                        accept="image/*"
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>{t("adm_tags")}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div>
                                    <Label htmlFor="tags">{t("adm_tagsHelp")}</Label>
                                    <Input
                                        id="tags"
                                        value={formData.tags}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, tags: e.target.value })}
                                        placeholder={t("adm_tagsPlaceholder")}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </form>
        </>
    );
}
