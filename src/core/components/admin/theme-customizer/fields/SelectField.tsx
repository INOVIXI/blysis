"use client";

import { useTranslations } from "next-intl";
import { ResetToDefault } from "./ResetToDefault";
import type { FieldProps } from "./types";
import { NativeSelect } from "@/core/components/ui/native-select";

export function SelectField({ def, value, onChange, isDefault }: FieldProps<string>) {
    // An option's key comes from a manifest core does not write, so whether
    // it resolves is asked rather than assumed, as SchemaForm does for the
    // field's own label.
    const translate = useTranslations("admin");
    if (def.type !== "select") return null;
    const current = typeof value === "string" ? value : def.default ?? def.options[0]?.value ?? "";

    return (
        <label className="flex items-center gap-2 text-sm">
            <NativeSelect
                value={current}
                onChange={(e) => onChange(e.target.value)} inputSize="sm"
            >
                {def.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.labelKey && translate.has(opt.labelKey) ? translate(opt.labelKey) : opt.label}
                    </option>
                ))}
            </NativeSelect>
            {!isDefault && <ResetToDefault onReset={() => onChange(undefined)} />}
        </label>
    );
}
