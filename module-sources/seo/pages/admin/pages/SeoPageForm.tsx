"use client";

/**
 * The right pane: what one page will tell a search engine.
 *
 * Every field is an override and every field is optional. What the page says
 * about itself is shown as the placeholder, so an operator can see the default
 * they are about to replace rather than facing an empty box with no clue what
 * it currently produces. Leaving them all empty and saving puts the page back
 * on its own wording.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge, Button, CheckboxField, Input, Label, Textarea, UrlOrFile} from "@/core/sdk/ui";
import { ChevronDown, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import type { CataloguePage, OverrideForm } from "../../../lib/catalogue";

/** What a search result shows before it cuts the text off. */
const TITLE_BUDGET = 60;
const DESCRIPTION_BUDGET = 160;

interface Props {
    page: CataloguePage;
    form: OverrideForm;
    hasOverride: boolean;
    saving: boolean;
    onChange: <K extends keyof OverrideForm>(key: K, value: OverrideForm[K]) => void;
    onSubmit: () => void;
    onReset: () => void;
}

export function SeoPageForm({ page, form, hasOverride, saving, onChange, onSubmit, onReset }: Props) {
    const t = useTranslations("seo");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const AdvancedIcon = showAdvanced ? ChevronDown : ChevronRight;

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
            }}
            className="space-y-5"
        >
            <div>
                <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-foreground">{page.title}</h2>
                    <Badge tone={page.owner === "core" ? "neutral" : "info"}>
                        {page.owner === "core" ? t("adm_ownerCore") : page.owner}
                    </Badge>
                    {page.pattern && <Badge tone="warning">{t("adm_pattern")}</Badge>}
                    {!page.indexable && <Badge tone="danger">{t("adm_noIndex")}</Badge>}
                </div>
                <p className="font-mono text-xs text-muted-foreground mt-1 break-all">{page.path}</p>
                {page.pattern && <p className="text-xs text-muted-foreground mt-2">{t("adm_patternHelp")}</p>}
            </div>

            <div>
                <Label className="text-foreground">{t("adm_metaTitle")}</Label>
                <Input
                    aria-label={t("adm_metaTitle")}
                    value={form.metaTitle}
                    onChange={(e) => onChange("metaTitle", e.target.value)}
                    placeholder={page.title}
                />
                <p className="text-xs text-muted-foreground mt-1">
                    {form.metaTitle
                        ? t("adm_charCount", { count: form.metaTitle.length, max: TITLE_BUDGET })
                        : t("adm_usingDefault")}
                </p>
            </div>

            <div>
                <Label className="text-foreground">{t("adm_metaDescription")}</Label>
                <Textarea
                    aria-label={t("adm_metaDescription")}
                    value={form.metaDescription}
                    onChange={(e) => onChange("metaDescription", e.target.value)}
                    placeholder={page.description || t("adm_metaDescriptionPlaceholder")}
                    rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">
                    {form.metaDescription
                        ? t("adm_charCount", { count: form.metaDescription.length, max: DESCRIPTION_BUDGET })
                        : page.description
                          ? t("adm_usingDefault")
                          : t("adm_noDefaultDescription")}
                </p>
            </div>

            <div>
                <UrlOrFile
                    label={t("adm_ogImage")}
                    value={form.ogImage}
                    onChange={(v) => onChange("ogImage", v)}
                    accept="image/*"
                    placeholder="https://example.com/og-image.png"
                />
                <p className="text-xs text-muted-foreground mt-1">{t("adm_ogImageHelp")}</p>
            </div>

            <div className="border-t border-border pt-4">
                <button
                    type="button"
                    onClick={() => setShowAdvanced((open) => !open)}
                    aria-expanded={showAdvanced}
                    className="flex items-center gap-1 text-sm font-medium text-foreground"
                >
                    <AdvancedIcon className="w-4 h-4" aria-hidden="true" />
                    {t("adm_advanced")}
                </button>

                {showAdvanced && (
                    <div className="space-y-4 mt-4">
                        <div>
                            <Label className="text-foreground">{t("adm_ogTitle")}</Label>
                            <Input
                                aria-label={t("adm_ogTitle")}
                                value={form.ogTitle}
                                onChange={(e) => onChange("ogTitle", e.target.value)}
                                placeholder={form.metaTitle || page.title}
                            />
                        </div>
                        <div>
                            <Label className="text-foreground">{t("adm_ogDescription")}</Label>
                            <Textarea
                                aria-label={t("adm_ogDescription")}
                                value={form.ogDescription}
                                onChange={(e) => onChange("ogDescription", e.target.value)}
                                placeholder={form.metaDescription || page.description}
                                rows={2}
                            />
                        </div>
                        <div>
                            <Label className="text-foreground">{t("adm_keywords")}</Label>
                            <Input
                                aria-label={t("adm_keywords")}
                                value={form.keywords}
                                onChange={(e) => onChange("keywords", e.target.value)}
                                placeholder="keyword1, keyword2, keyword3"
                            />
                        </div>
                        <div>
                            <Label className="text-foreground">{t("adm_canonicalUrl")}</Label>
                            <Input
                                aria-label={t("adm_canonicalUrl")}
                                value={form.canonical}
                                onChange={(e) => onChange("canonical", e.target.value)}
                                placeholder="https://example.com/canonical-page"
                            />
                        </div>
                        <CheckboxField
                            checked={form.noIndex}
                            onChange={(e) => onChange("noIndex", e.target.checked)}
                            label={<span className="font-medium">{t("adm_noIndex")}</span>}
                            description={t("adm_noIndexDesc")}
                        />
                        <CheckboxField
                            checked={form.noFollow}
                            onChange={(e) => onChange("noFollow", e.target.checked)}
                            label={<span className="font-medium">{t("adm_noFollow")}</span>}
                            description={t("adm_noFollowDesc")}
                        />
                    </div>
                )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                {hasOverride && (
                    <Button type="button" variant="outline" onClick={onReset} disabled={saving}>
                        <RotateCcw className="w-4 h-4" aria-hidden="true" /> {t("adm_resetToDefault")}
                    </Button>
                )}
                <Button type="submit" disabled={saving}>
                    {saving ? (
                        <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> {t("adm_saving")}</>
                    ) : (
                        t("adm_saveSettings")
                    )}
                </Button>
            </div>
        </form>
    );
}
