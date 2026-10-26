"use client";

import { useState, useEffect } from "react";
import { useRouter } from "@/core/sdk/navigation";
import { Button, Card, CardContent, Input, Label, LoadFailed, Textarea, NativeSelect } from "@/core/sdk/ui";
import { ArrangedClientPage } from "@/core/sdk/layout";
import { Loader2, FolderPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { writeError } from "@/core/sdk";

interface Category {
    id: string;
    name: string;
    slug: string;
}

export default function NewTopicPage() {
    const router = useRouter();
    const t = useTranslations('forum');
    const commonT = useTranslations('common');
    const [categories, setCategories] = useState<Category[]>([]);
    const [categoriesLoaded, setCategoriesLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [form, setForm] = useState({
        title: "",
        content: "",
        categoryId: "",
    });

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/forum/categories")
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d) => { if (cancelled) return; setCategories(d.categories || []); setFailed(false); })
            .catch(() => { if (cancelled) return; setFailed(true); })
            .finally(() => { if (cancelled) return; setCategoriesLoaded(true); });
        return () => { cancelled = true; };
    }, [reloadKey]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);

        try {
            const res = await fetch("/api/v1/forum/topics", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });

            const failed = await writeError(res, t('createTopicFailed'), t);
            if (failed) {
                setError(failed);
                return;
            }

            const data = await res.json();
            router.push(`/forum/topic/${data.topic.number}/${data.topic.slug}`);
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <ArrangedClientPage
            page="forum.new"
            frame={{ title: t('newTopic'), trail: [{ label: t('title'), href: '/forum' }] }}
            blocks={{
                form: () => (
                    <Card>
                        <CardContent className="pt-6">
                            {failed ? (
                                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                            ) : categoriesLoaded && categories.length === 0 ? (
                                <div className="text-center py-10">
                                    <FolderPlus className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
                                    <p className="font-medium text-foreground">{t('noCategoriesTitle')}</p>
                                    <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{t('noCategoriesHelp')}</p>
                                </div>
                            ) : (
                                <>
                                    {error && (
                                        <div role="alert" className="mb-4 p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg">
                                            {error}
                                        </div>
                                    )}

                                    <form onSubmit={handleSubmit} className="space-y-4">
                                        <div>
                                            <Label>{t('categoryLabel')}</Label>
                                            <NativeSelect
                                                aria-label={t('categoryLabel')}
                                                value={form.categoryId}
                                                onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="w-full"
                                                required
                                            >
                                                <option value="">{t('selectCategory')}</option>
                                                {categories.map((cat) => (
                                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                ))}
                                            </NativeSelect>
                                        </div>

                                        <div>
                                            <Label>{t('titleLabel')}</Label>
                                            <Input
                                                aria-label={t('titleLabel')}
                                                value={form.title}
                                                onChange={(e) => setForm({ ...form, title: e.target.value })}
                                                placeholder={t('topicTitle')}
                                                required
                                                minLength={3}
                                            />
                                        </div>

                                        <div>
                                            <Label>{t('contentLabel')}</Label>
                                            <Textarea
                                                aria-label={t('contentLabel')}
                                                value={form.content}
                                                onChange={(e) => setForm({ ...form, content: e.target.value })}
                                                placeholder={t('topicContent')}
                                                rows={8}
                                                required
                                                minLength={10}
                                            />
                                        </div>

                                        <Button type="submit" disabled={saving}>
                                            {saving ? (
                                                <><Loader2 className="w-4 h-4 animate-spin" /> {t('creating')}</>
                                            ) : (
                                                t('createTopic')
                                            )}
                                        </Button>
                                    </form>
                                </>
                            )}
                        </CardContent>
                    </Card>
                ),
            }}
        />
    );
}
