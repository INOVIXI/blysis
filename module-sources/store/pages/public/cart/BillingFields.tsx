"use client";

import { useTranslations } from "next-intl";
import { Input, Label, NativeSelect, RadioField } from "@/core/sdk/ui";
import type { BillingDetails } from "../../../lib/billing";

/**
 * Who the invoice is made out to.
 *
 * Only drawn where something installed here issues invoices. A tax number in
 * front of every buyer is a longer checkout for a field nobody reads, and the
 * checkout asks the server which it is rather than guessing.
 *
 * The two extra boxes appear only for a company, because a person has neither
 * and a form demanding them of a person cannot be completed at all.
 */
export const EMPTY_BILLING: BillingDetails = {
    kind: "individual",
    name: "",
    taxNumber: "",
    taxOffice: "",
    address: "",
    city: "",
    country: "",
};

export function BillingFields({
    value,
    onChange,
    missing,
}: {
    value: BillingDetails;
    onChange: (next: BillingDetails) => void;
    missing: string[];
}) {
    const t = useTranslations("store");
    const set = (patch: Partial<BillingDetails>) => onChange({ ...value, ...patch });
    const wrong = (field: string) => missing.includes(field);

    return (
        <div className="space-y-4">
            <div>
                <Label>{t("billing_title")}</Label>
                <p className="text-sm text-muted-foreground">{t("billing_hint")}</p>
            </div>

            <div className="flex gap-4">
                <RadioField
                    id="billingIndividual"
                    name="billingKind"
                    label={t("billing_individual")}
                    checked={value.kind === "individual"}
                    onChange={() => set({ kind: "individual" })}
                />
                <RadioField
                    id="billingCompany"
                    name="billingKind"
                    label={t("billing_company")}
                    checked={value.kind === "company"}
                    onChange={() => set({ kind: "company" })}
                />
            </div>

            <div>
                <Label htmlFor="billingName">
                    {value.kind === "company" ? t("billing_companyName") : t("billing_name")}
                </Label>
                <Input
                    id="billingName"
                    value={value.name}
                    onChange={(e) => set({ name: e.target.value })}
                    aria-invalid={wrong("name")}
                    required
                />
            </div>

            {value.kind === "company" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="billingTaxNumber">{t("billing_taxNumber")}</Label>
                        <Input
                            id="billingTaxNumber"
                            value={value.taxNumber}
                            onChange={(e) => set({ taxNumber: e.target.value })}
                            aria-invalid={wrong("taxNumber")}
                            required
                        />
                    </div>
                    <div>
                        <Label htmlFor="billingTaxOffice">{t("billing_taxOffice")}</Label>
                        <Input
                            id="billingTaxOffice"
                            value={value.taxOffice}
                            onChange={(e) => set({ taxOffice: e.target.value })}
                            aria-invalid={wrong("taxOffice")}
                            required
                        />
                    </div>
                </div>
            )}

            <div>
                <Label htmlFor="billingAddress">{t("billing_address")}</Label>
                <Input
                    id="billingAddress"
                    value={value.address}
                    onChange={(e) => set({ address: e.target.value })}
                    aria-invalid={wrong("address")}
                    required
                />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                    <Label htmlFor="billingCity">{t("billing_city")}</Label>
                    <Input
                        id="billingCity"
                        value={value.city}
                        onChange={(e) => set({ city: e.target.value })}
                        aria-invalid={wrong("city")}
                        required
                    />
                </div>
                <div>
                    <Label htmlFor="billingCountry">{t("billing_country")}</Label>
                    {/*
                      * A code rather than a free box: "Turkey" is not a country
                      * to anything downstream, and a typed name means an
                      * invoice refused long after the sale.
                      */}
                    <NativeSelect
                        id="billingCountry"
                        value={value.country}
                        onChange={(e) => set({ country: e.target.value })}
                        aria-invalid={wrong("country")}
                        required
                    >
                        <option value="">{t("billing_pickCountry")}</option>
                        {COUNTRIES.map((code) => (
                            <option key={code} value={code}>{t(`billing_country_${code}`)}</option>
                        ))}
                    </NativeSelect>
                </div>
            </div>
        </div>
    );
}

/**
 * The codes this shop can name. Short on purpose: every one of them is a word
 * in both catalogues, and a list of two hundred is four hundred strings for a
 * shop that sells in one country. A module that files somewhere else adds its
 * own.
 */
const COUNTRIES = ["TR", "GB", "DE", "FR", "NL", "US"] as const;
