"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { Loader2 } from "lucide-react";
import type { Module, ModuleSettingValues } from "./types";
import { CheckboxField } from "@/core/components/ui/checkbox";

/**
 * The settings form for one installed module, built entirely from what that
 * module's manifest declares.
 *
 * Core knows none of these keys. A module adds a `settings` entry and gets a
 * labelled, bounded control here, with no core change - the same contract every
 * other module surface follows. Before this existed the declarations were
 * invisible: an admin had no way to reach a single one of them.
 *
 * It renders on the module's own screen, not folded into its card in the
 * marketplace listing - see that screen for why.
 */
export function ModuleSettingsPanel({
    module: mod,
    onSave,
}: {
    module: Module;
    onSave: (moduleId: string, config: ModuleSettingValues) => Promise<boolean>;
}) {
    const t = useTranslations("admin");
    const declarations = mod.settings ?? [];
    const stored: ModuleSettingValues = mod.config ?? {};

    const [values, setValues] = useState<ModuleSettingValues>(() => {
        const initial: ModuleSettingValues = {};
        for (const setting of declarations) {
            initial[setting.key] = stored[setting.key] ?? setting.default;
        }
        return initial;
    });
    const [saving, setSaving] = useState(false);

    if (declarations.length === 0) return null;

    const dirty = declarations.some((s) => values[s.key] !== (stored[s.key] ?? s.default));

    const save = async () => {
        setSaving(true);
        try {
            // Whatever onSave does with a failure is its own business; what
            // this owns is the button, and a rejection used to leave it
            // disabled with no way back but a reload.
            await onSave(mod.id, values);
        } finally {
            setSaving(false);
        }
    };

    // A module that declares eight settings used to list them down a
    // 36rem column with the rest of the panel blank beside it.
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {declarations.map((setting) => {
                    const id = `module-setting-${mod.id}-${setting.key}`;
                    const value = values[setting.key];
                    return (
                        <div key={setting.key} className="text-sm">
                            {setting.type === "boolean" ? (
                                <CheckboxField
                                    id={id}
                                    checked={value === true}
                                    onChange={(e) =>
                                        setValues((v) => ({ ...v, [setting.key]: e.target.checked }))
                                    }
                                    label={<span className="font-medium">{setting.label}</span>}
                                    description={setting.description}
                                />
                            ) : (
                                <div className="space-y-1">
                                    <label htmlFor={id} className="font-medium block">{setting.label}</label>
                                    {setting.description && (
                                        <span className="block text-muted-foreground">{setting.description}</span>
                                    )}
                                    <Input
                                        id={id}
                                        className="text-sm"
                                        type={setting.type === "number" ? "number" : "text"}
                                        min={setting.min}
                                        max={setting.max}
                                        step={setting.step}
                                        maxLength={setting.maxLength}
                                        value={String(value ?? "")}
                                        onChange={(e) =>
                                            setValues((v) => ({
                                                ...v,
                                                [setting.key]:
                                                    setting.type === "number"
                                                        // An empty box is not a number. Keep the declared
                                                        // default rather than sending NaN, which the server
                                                        // would reject as "must be a finite number".
                                                        ? (e.target.value === "" ? setting.default : Number(e.target.value))
                                                        : e.target.value,
                                            }))
                                        }
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <Button disabled={!dirty || saving} onClick={save}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("modules_settingsSave")}
            </Button>
        </div>
    );
}
