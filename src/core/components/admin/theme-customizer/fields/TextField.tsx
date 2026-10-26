"use client";

import { useRef } from "react";
import { Input } from "@/core/components/ui/input";
import { PlaceholderPicker } from "./PlaceholderPicker";
import { ResetToDefault } from "./ResetToDefault";
import type { FieldProps } from "./types";

export function TextField({ def, value, onChange, isDefault }: FieldProps<string>) {
    const input = useRef<HTMLInputElement>(null);
    if (def.type !== "text") return null;
    const current = typeof value === "string" ? value : def.default ?? "";

    // Where the caret is, or at the end when the field was never focused.
    const insert = (token: string) => {
        const start = input.current?.selectionStart ?? current.length;
        const end = input.current?.selectionEnd ?? start;
        onChange(current.slice(0, start) + token + current.slice(end));
    };

    return (
        <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
                <Input
                    ref={input}
                    type="text"
                    value={current}
                    maxLength={def.max ?? 10000}
                    onChange={(e) => onChange(e.target.value)}
                    aria-label={def.label}
                />
                {!isDefault && <ResetToDefault onReset={() => onChange(undefined)} />}
            </label>
            {def.placeholders && <PlaceholderPicker text={current} onPick={insert} />}
        </div>
    );
}
