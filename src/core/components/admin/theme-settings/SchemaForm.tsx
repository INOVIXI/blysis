"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import * as Fields from "@/core/components/admin/theme-customizer/fields";
import type { ThemeFieldDef } from "@/core/lib/theme-manifest-schema";
import { Button } from "@/core/components/ui/button";
import { Card, CardContent } from "@/core/components/ui/card";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { Check, Loader2 } from "lucide-react";

interface Props {
    themeId: string;
    group: string;
    fields: Record<string, ThemeFieldDef>;
    initialValues: Record<string, unknown>;
    /**
     * The page's own title row. It is rendered here rather than by the page
     * because the save button belongs in it, and only this component knows
     * whether a save is in flight.
     */
    title: string;
    description: string;
    backHref: string;
    backLabel: string;
}

export function SchemaForm({ themeId, group, fields, initialValues, title, description, backHref, backLabel }: Props) {
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...initialValues }));
    const [saving, setSaving] = useState(false);

    const set = (key: string, v: unknown) => setValues(prev => ({ ...prev, [key]: v }));

    const onSubmit = async () => {
        setSaving(true);
        try {
            const res = await fetch(`/api/v1/themes/${themeId}/settings/${group}`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ values }),
            });
            if (!res.ok) { toast.error(t("theme_saveFailed")); return; }
            toast.success(t("theme_saved"));
        } catch {
            toast.error(t("theme_saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            {/* The save is a header action, next to the way back, like the
                appearance screen one click away. It used to sit alone in a
                right-aligned row between the header and the card, which left
                the header's own right hand side empty and put the same button
                in a different place on two screens of the same section. */}
            <AdminPageHeader
                title={title}
                description={description}
                backHref={backHref}
                backLabel={backLabel}
                actions={
                    <Button onClick={onSubmit} disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        {saving ? t("theme_saving") : commonT("save")}
                    </Button>
                }
            />

            <Card>
                <CardContent className="grid gap-6 p-6 md:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(fields).map(([key, def]) => (
                        <FieldRow key={key} fieldKey={key} def={def} value={values[key]} onChange={(v) => set(key, v)} />
                    ))}
                </CardContent>
            </Card>
        </>
    );
}

function FieldRow({ fieldKey, def, value, onChange }: { fieldKey: string; def: ThemeFieldDef; value: unknown; onChange: (v: unknown) => void }) {
    const t = useTranslations("admin");
    const isDefault = value === undefined;
    // ColorField renders its own label inline (color swatch + label side by
    // side); every other field component only renders the input, so we
    // stack a label header above.
    /*
     * The theme's own word for this field, in the reader's language.
     *
     * It used to be `def.label ?? fieldKey`: a literal the theme's author
     * typed, or failing that the column name. So every label on every theme
     * settings screen was whatever English got written, and a Turkish
     * operator read "Show hero on homepage" with the panel's chrome in
     * Turkish around it.
     *
     * The literal stays as the fallback. A theme somebody else wrote may
     * declare no key and still has to render something, and the key is the
     * only honest use of a `t.has` guard - it is built from a manifest core
     * has never seen.
     */
    const label = (def.labelKey && t.has(def.labelKey) ? t(def.labelKey) : def.label) ?? fieldKey;
    const inner = renderField(def, value, onChange, isDefault);
    /*
     * Fields that do not share a row.
     *
     * An editor or an image picker squeezed into a third of the row is
     * unusable; a switch is the opposite problem and the same mistake. It is
     * eighteen pixels tall beside inputs that are forty, so the hero screen
     * put "Show hero on homepage" and its little box next to "Title" and its
     * full-height field, and the row read as misaligned because it was.
     */
    const wide = def.type === "richtext" || def.type === "image" || def.type === "toggle";
    if (def.type === "color") return inner;
    return (
        <div className={`space-y-1.5${wide ? " md:col-span-2 xl:col-span-3" : ""}`}>
            <div className="text-sm font-medium">{label}</div>
            {inner}
        </div>
    );
}

function renderField(def: ThemeFieldDef, value: unknown, onChange: (v: unknown) => void, isDefault: boolean) {
    switch (def.type) {
        case "color":    return <Fields.ColorField def={def} value={value as string} onChange={onChange as (v: string | undefined) => void} isDefault={isDefault} />;
        case "font":     return <Fields.FontField  def={def} value={value as string} onChange={onChange as (v: string | undefined) => void} isDefault={isDefault} />;
        case "select":   return <Fields.SelectField def={def} value={value as string} onChange={onChange as (v: string | undefined) => void} isDefault={isDefault} />;
        case "slider":   return <Fields.SliderField def={def} value={value as number} onChange={onChange as (v: number | undefined) => void} isDefault={isDefault} />;
        case "toggle":   return <Fields.ToggleField def={def} value={value as boolean} onChange={onChange as (v: boolean | undefined) => void} isDefault={isDefault} />;
        case "text":     return <Fields.TextField   def={def} value={value as string} onChange={onChange as (v: string | undefined) => void} isDefault={isDefault} />;
        case "url":      return <Fields.UrlField    def={def} value={value as string} onChange={onChange as (v: string | undefined) => void} isDefault={isDefault} />;
        case "richtext": return <Fields.RichTextField def={def} value={value as string} onChange={onChange as (v: string | undefined) => void} isDefault={isDefault} />;
        case "image":    return <Fields.ImageField  def={def} value={value as string} onChange={onChange as (v: string | undefined) => void} isDefault={isDefault} />;
        case "number":   return <Fields.SliderField def={{ type: "slider", min: (def as { min?: number }).min ?? 0, max: (def as { max?: number }).max ?? 100, label: def.label, default: (def as { default?: number }).default }} value={value as number} onChange={onChange as (v: number | undefined) => void} isDefault={isDefault} />;
    }
}
