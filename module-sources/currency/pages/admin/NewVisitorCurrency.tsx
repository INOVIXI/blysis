"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, Label, NativeSelect } from "@/core/sdk/ui";
import { useLanguageChoice } from "@/core/sdk/theme";

interface NewVisitorCurrencyProps {
    base: string;
    /** The codes the site offers, the base among them. */
    offered: string[];
    defaultDisplay: string;
    languageDisplay: Record<string, string>;
    onChange: (patch: { defaultDisplay?: string; languageDisplay?: Record<string, string> }) => void;
}

/**
 * Which currency a visitor who never picked one reads.
 *
 * Saved with the currency list it names, by the screen's own save, because a
 * default can only name a currency the list offers. Only switched-on
 * currencies are offered here, and the endpoint lets go of a default whose
 * currency was switched off since.
 */
export function NewVisitorCurrency({ base, offered, defaultDisplay, languageDisplay, onChange }: NewVisitorCurrencyProps) {
    const t = useTranslations("currency");
    const { options: languages } = useLanguageChoice();
    const others = offered.filter((code) => code !== "" && code !== base);

    // A language that should read the base names it, rather than leaving the
    // entry empty: empty means "as the default above", which may not be it.
    const languageChoices = [base, ...others];

    return (
        <Card className="mt-6">
            <CardHeader>
                <CardTitle>{t("adm_newVisitorTitle")}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{t("adm_newVisitorHint", { base })}</p>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="currency-default-display">{t("adm_defaultDisplay")}</Label>
                        <NativeSelect
                            id="currency-default-display"
                            className="w-full"
                            value={others.includes(defaultDisplay) ? defaultDisplay : ""}
                            onChange={(e) => onChange({ defaultDisplay: e.target.value })}
                        >
                            <option value="">{t("adm_baseOption", { code: base })}</option>
                            {others.map((code) => <option key={code} value={code}>{code}</option>)}
                        </NativeSelect>
                    </div>
                </div>

                {languages.length > 1 && (
                    <div className="space-y-3">
                        <div>
                            <p className="text-sm font-medium">{t("adm_byLanguage")}</p>
                            <p className="text-xs text-muted-foreground">{t("adm_byLanguageHint")}</p>
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {languages.map((language) => (
                                <div key={language.value}>
                                    <Label htmlFor={`currency-language-${language.value}`}>{language.label}</Label>
                                    <NativeSelect
                                        id={`currency-language-${language.value}`}
                                        className="w-full"
                                        value={languageChoices.includes(languageDisplay[language.value] ?? "") ? languageDisplay[language.value] : "*"}
                                        onChange={(e) => {
                                            const next = { ...languageDisplay };
                                            if (e.target.value === "*") delete next[language.value];
                                            else next[language.value] = e.target.value;
                                            onChange({ languageDisplay: next });
                                        }}
                                    >
                                        <option value="*">{t("adm_sameAsDefault")}</option>
                                        <option value={base}>{t("adm_baseOption", { code: base })}</option>
                                        {others.map((code) => <option key={code} value={code}>{code}</option>)}
                                    </NativeSelect>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
