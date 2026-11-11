"use client";

import { useRef } from "react";
import { Input } from "@/core/components/ui/input";
import { LocalizedTextInput } from "@/core/components/ui/localized-text-input";
import { isTranslatableText, originalText, type TranslatableText } from "@/core/lib/i18n/translatable-text";
import { PlaceholderPicker } from "./PlaceholderPicker";
import { ResetToDefault } from "./ResetToDefault";
import type { FieldProps } from "./types";

/**
 * A theme's text setting. Prose is written once and then per language the
 * site offers, as every theme's heading may be, whichever theme it is; a
 * field the theme marked `"translatable": false`, an address or a link, is
 * one box as it always was.
 */
export function TextField({ def, value, onChange, isDefault }: FieldProps<TranslatableText>) {
    const input = useRef<HTMLInputElement>(null);
    if (def.type !== "text") return null;
    const current: TranslatableText = isTranslatableText(value) ? value : def.default ?? "";
    const original = originalText(current);

    // Where the caret is in the original, or at its end when the field was
    // never focused. A placeholder goes into the original; a translation is
    // typed with its own.
    const insert = (token: string) => {
        const start = input.current?.selectionStart ?? original.length;
        const end = input.current?.selectionEnd ?? start;
        const text = original.slice(0, start) + token + original.slice(end);
        onChange(typeof current === "string" ? text : { ...current, default: text });
    };

    return (
        <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm">
                <div className="flex-1 min-w-0">
                    {def.translatable === false ? (
                        <Input
                            ref={input}
                            type="text"
                            value={original}
                            maxLength={def.max ?? 10000}
                            onChange={(e) => onChange(e.target.value)}
                            aria-label={def.label}
                        />
                    ) : (
                        <LocalizedTextInput
                            inputRef={input}
                            value={current}
                            maxLength={def.max ?? 10000}
                            onChange={onChange}
                            label={def.label ?? ""}
                        />
                    )}
                </div>
                {!isDefault && <ResetToDefault onReset={() => onChange(undefined)} />}
            </div>
            {def.placeholders && <PlaceholderPicker text={original} onPick={insert} />}
        </div>
    );
}
