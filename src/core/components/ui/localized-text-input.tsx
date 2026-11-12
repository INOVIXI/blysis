"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronUp, Languages } from "lucide-react";
import { Input } from "@/core/components/ui/input";
import { Textarea } from "@/core/components/ui/textarea";
import { Button } from "@/core/components/ui/button";
import { RichTextEditor } from "@/core/components/ui/rich-text-editor";
import { useSiteSettings } from "@/core/hooks/useSiteSettings";
import { siteLanguagesOf } from "@/core/lib/i18n/site-languages";
import { localeNames, locales, type Locale } from "@/core/lib/i18n/config";
import { cn } from "@/core/lib/utils";
import { originalText, type TranslatableText, type TranslatedText } from "@/core/lib/i18n/translatable-text";

export interface LocalizedTextInputProps {
    /** What the text is, which also names each language's box. */
    label: string;
    value: TranslatableText | undefined;
    onChange: (value: TranslatableText) => void;
    /** A textarea rather than one line. */
    multiline?: boolean;
    /**
     * A Markdown body in the site's editor, the original and each language
     * alike, so a page's translation is written with the same tools as the
     * page.
     */
    rich?: boolean;
    /**
     * The element naming the original's rich editor, a visible `<Label>` above
     * it, so the name a screen reader gives the field is the one on the
     * screen. Without it the editor carries its label as hidden text.
     */
    labelledBy?: string;
    /** How tall a rich editor starts; a sentence wants less than an article. */
    minHeight?: string;
    rows?: number;
    maxLength?: number;
    placeholder?: string;
    /** The original must be filled; a translation never has to be. */
    required?: boolean;
    id?: string;
    /** The original's box, for a caller that inserts at its caret. */
    inputRef?: React.Ref<HTMLInputElement>;
}

function translationsOf(value: TranslatableText | undefined): Partial<Record<Locale, string>> {
    if (!value || typeof value === "string") return {};
    const out: Partial<Record<Locale, string>> = {};
    for (const locale of locales) {
        const entry = (value as TranslatedText)[locale];
        if (typeof entry === "string") out[locale] = entry;
    }
    return out;
}

/**
 * Text the operator writes, once and then per language.
 *
 * The original stays in front, in the box the admin has always typed into,
 * and is what any language left empty shows. The site's languages open
 * beneath it on request, each named in itself and marked when it holds a
 * translation, so a screen with ten such fields is still ten boxes until the
 * admin asks for more. A language the site has stopped offering still shows
 * while it holds a translation, so nothing stored is out of reach.
 *
 * What it hands back is the shape `translatable-text.ts` reads: the plain
 * string while there is no translation, so a value nobody translated is
 * stored exactly as it was before this existed.
 */
export function LocalizedTextInput({
    label, value, onChange, multiline = false, rich = false, labelledBy, minHeight, rows = 3, maxLength, placeholder, required, id, inputRef,
}: LocalizedTextInputProps) {
    const t = useTranslations("common");
    const { settings } = useSiteSettings();
    const [open, setOpen] = React.useState(false);
    const [picked, setPicked] = React.useState<Locale | null>(null);
    const panelId = React.useId();
    const nameId = React.useId();

    const original = originalText(value);
    const translations = translationsOf(value);
    const site = siteLanguagesOf(settings.site_languages, settings.default_locale);
    // The site's own language is the one the original is written in, so it is
    // not offered as a translation of itself, unless one was stored for it.
    const hasText = (l: Locale) => (translations[l] ?? "").trim() !== "";
    const shown = locales.filter((l) => (site.offered.includes(l) && l !== site.preferred) || hasText(l));
    const filled = shown.filter((l) => (translations[l] ?? "").trim() !== "").length;

    const active: Locale | null = picked && shown.includes(picked) ? picked : (shown[0] ?? null);

    const emit = (nextOriginal: string, next: Partial<Record<Locale, string>>) => {
        const kept = Object.entries(next).filter(([, text]) => (text ?? "").trim() !== "");
        onChange(kept.length === 0 ? nextOriginal : { default: nextOriginal, ...Object.fromEntries(kept) });
    };

    const box = (boxValue: string, onText: (text: string) => void, name: string, boxId?: string, ref?: React.Ref<HTMLInputElement>, key = "original") => {
        const must = key === "original" && required;
        if (rich) {
            // The editor is named by an element rather than an aria-label,
            // so each box carries its name beside it, for a screen reader.
            const named = key === "original" && labelledBy ? labelledBy : `${nameId}-${key}`;
            return (
                <div id={boxId}>
                    {named !== labelledBy && <span id={named} className="sr-only">{name}</span>}
                    <RichTextEditor value={boxValue} placeholder={placeholder} labelledBy={named}
                        minHeight={minHeight ?? (key === "original" ? undefined : "160px")} onChange={onText} />
                </div>
            );
        }
        return multiline ? (
            <Textarea id={boxId} value={boxValue} rows={rows} maxLength={maxLength} placeholder={placeholder}
                required={must} aria-label={name} onChange={(e) => onText(e.target.value)} />
        ) : (
            <Input ref={ref} id={boxId} value={boxValue} maxLength={maxLength} placeholder={placeholder}
                required={must} aria-label={name} onChange={(e) => onText(e.target.value)} />
        );
    };

    return (
        <div className="space-y-2">
            {box(original, (text) => emit(text, translations), label, id, inputRef)}
            <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen(!open)}
            >
                <Languages className="w-4 h-4" aria-hidden="true" />
                {t("localizedText_translations", { filled, total: shown.length })}
                {open ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
            </Button>
            {open && (
                <div id={panelId} className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">{t("localizedText_fallbackHint")}</p>
                    {/* One language at a time: twelve stacked boxes made a
                        one-line field taller than the screen. */}
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("localizedText_translations", { filled, total: shown.length })}>
                        {shown.map((locale) => {
                            const isFilled = hasText(locale);
                            const isActive = locale === active;
                            return (
                                <button
                                    key={locale}
                                    type="button"
                                    aria-pressed={isActive}
                                    aria-label={`${localeNames[locale]}, ${isFilled ? t("localizedText_filled") : t("localizedText_empty")}`}
                                    onClick={() => setPicked(locale)}
                                    className={cn(
                                        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                                        isActive ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {isFilled && <Check className="w-3 h-3 text-success" aria-hidden="true" />}
                                    {localeNames[locale]}
                                </button>
                            );
                        })}
                    </div>
                    {active && (
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">
                                {hasText(active) ? t("localizedText_filled") : t("localizedText_empty")}
                            </p>
                            {box(
                                translations[active] ?? "",
                                (next) => emit(original, { ...translations, [active]: next }),
                                t("localizedText_languageField", { label, language: localeNames[active] }),
                                undefined,
                                undefined,
                                active,
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
