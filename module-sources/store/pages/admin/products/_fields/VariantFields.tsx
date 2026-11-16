"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CheckboxField,
    Input,
    Label,
    LocalizedTextInput,
    NativeSelect,
    useConfirm,
} from "@/core/sdk/ui";
import { RowActions } from "@/core/sdk/admin";
import { emptyVariant, type VariantCommandDraft, type VariantDraft } from "./variant-payload";

/**
 * The ways a product is sold: a pack of three keys, a rank for six months.
 *
 * Each variant has its own name and price, and may change what the delivery
 * does: how many units it hands out, how long it lasts, values its commands
 * read as `{name}`, and commands of its own in place of the product's. A
 * product with none here is sold as itself, exactly as before.
 */
interface Props {
    value: VariantDraft[];
    onChange: (next: VariantDraft[]) => void;
}

export function VariantFields({ value, onChange }: Props) {
    const t = useTranslations("store");
    const { confirm } = useConfirm();
    const [servers, setServers] = useState<{ id: string; name: string }[]>([]);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/servers")
            .then((r) => (r.ok ? r.json() : { servers: [] }))
            .then((d) => {
                if (!cancelled) setServers(d.servers || []);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const update = (index: number, patch: Partial<VariantDraft>) =>
        onChange(value.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

    const move = (index: number, by: number) => {
        const to = index + by;
        if (to < 0 || to >= value.length) return;
        const next = [...value];
        [next[index], next[to]] = [next[to], next[index]];
        onChange(next);
    };

    const remove = async (index: number) => {
        // A variant that was ever ordered is kept, switched off, when the
        // product is saved; the question is still asked, because to the
        // operator it disappears from the shop either way.
        const ok = await confirm({
            title: t("adm_variantRemove"),
            message: t("adm_variantRemoveConfirm"),
            confirmText: t("adm_variantRemove"),
            variant: "danger",
        });
        if (ok) onChange(value.filter((_, i) => i !== index));
    };

    const setCommand = (index: number, at: number, patch: Partial<VariantCommandDraft>) =>
        update(index, { commands: value[index].commands.map((c, i) => (i === at ? { ...c, ...patch } : c)) });

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("adm_variants")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("adm_variantsHint")}</p>
            </CardHeader>
            <CardContent className="space-y-4">
                {value.map((draft, index) => {
                    const id = (name: string) => `variant-${index}-${name}`;
                    return (
                        <div key={draft.id ?? `new-${index}`} className="space-y-3 rounded-lg border border-border p-4">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-foreground">{t("adm_variantNumber", { number: index + 1 })}</span>
                                <RowActions
                                    actions={[
                                        { icon: ArrowUp, label: t("adm_variantMoveUp"), onClick: () => move(index, -1), disabled: index === 0 },
                                        { icon: ArrowDown, label: t("adm_variantMoveDown"), onClick: () => move(index, 1), disabled: index === value.length - 1 },
                                        { icon: Trash2, label: t("adm_variantRemove"), onClick: () => remove(index), destructive: true },
                                    ]}
                                />
                            </div>

                            <LocalizedTextInput
                                label={t("adm_variantLabel")}
                                value={draft.label}
                                onChange={(label) => update(index, { label })}
                                maxLength={100}
                                placeholder={t("adm_variantLabelHint")}
                                required
                            />

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <div>
                                    <Label htmlFor={id("price")}>{t("adm_variantPrice")}</Label>
                                    <Input id={id("price")} type="number" min="0" step="0.01" value={draft.price} onChange={(e) => update(index, { price: e.target.value })} />
                                </div>
                                <div>
                                    <Label htmlFor={id("units")}>{t("adm_variantUnits")}</Label>
                                    <Input id={id("units")} type="number" min="1" step="1" value={draft.units} onChange={(e) => update(index, { units: e.target.value })} />
                                </div>
                                <div>
                                    <Label htmlFor={id("days")}>{t("adm_variantDuration")}</Label>
                                    <Input id={id("days")} type="number" min="1" step="1" value={draft.durationDays} onChange={(e) => update(index, { durationDays: e.target.value })} placeholder={t("adm_variantDurationHint")} />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">{t("adm_variantUnitsHint")}</p>

                            <div className="space-y-2">
                                <p className="text-sm font-medium text-foreground">{t("adm_variantVariables")}</p>
                                <p className="text-xs text-muted-foreground">{t("adm_variantVariablesHint")}</p>
                                {draft.variables.map((entry, at) => (
                                    <div key={at} className="flex items-center gap-2">
                                        <Input
                                            value={entry.name}
                                            onChange={(e) => update(index, { variables: draft.variables.map((v, i) => (i === at ? { ...v, name: e.target.value } : v)) })}
                                            placeholder="amount"
                                            aria-label={t("adm_variantVariableName")}
                                            className="font-mono text-xs"
                                            maxLength={64}
                                        />
                                        <Input
                                            value={entry.value}
                                            onChange={(e) => update(index, { variables: draft.variables.map((v, i) => (i === at ? { ...v, value: e.target.value } : v)) })}
                                            placeholder="3"
                                            aria-label={t("adm_variantVariableValue")}
                                            className="font-mono text-xs"
                                            maxLength={200}
                                        />
                                        <RowActions
                                            actions={[{ icon: Trash2, label: t("adm_variantRemoveVariable"), onClick: () => update(index, { variables: draft.variables.filter((_, i) => i !== at) }), destructive: true }]}
                                        />
                                    </div>
                                ))}
                                <Button type="button" variant="outline" size="sm" onClick={() => update(index, { variables: [...draft.variables, { name: "", value: "" }] })}>
                                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t("adm_variantAddVariable")}
                                </Button>
                            </div>

                            <div className="space-y-2">
                                <p className="text-sm font-medium text-foreground">{t("adm_variantCommands")}</p>
                                <p className="text-xs text-muted-foreground">{t("adm_variantCommandsHint")}</p>
                                {draft.commands.map((command, at) => (
                                    <div key={at} className="flex flex-wrap items-center gap-2">
                                        <NativeSelect
                                            value={command.target}
                                            onChange={(e) => setCommand(index, at, { target: e.target.value === "player" ? "player" : "server" })}
                                            aria-label={t("adm_cmdTarget")}
                                            className="w-40"
                                            inputSize="sm"
                                        >
                                            <option value="server">{t("adm_cmdOnServer")}</option>
                                            <option value="player">{t("adm_cmdPlayersServer")}</option>
                                        </NativeSelect>
                                        {servers.length > 0 && command.target === "server" && (
                                            <NativeSelect
                                                value={command.serverId}
                                                onChange={(e) => setCommand(index, at, { serverId: e.target.value })}
                                                aria-label={t("adm_defaultServer")}
                                                className="w-44"
                                                inputSize="sm"
                                            >
                                                <option value="">{t("adm_defaultServer")}</option>
                                                {servers.map((s) => (
                                                    <option key={s.id} value={s.id}>{s.name}</option>
                                                ))}
                                            </NativeSelect>
                                        )}
                                        {command.target === "server" && (
                                            <CheckboxField
                                                checked={command.whenOnline}
                                                onChange={(e) => setCommand(index, at, { whenOnline: e.target.checked })}
                                                label={t("adm_cmdWhenOnline")}
                                            />
                                        )}
                                        <Input
                                            value={command.command}
                                            onChange={(e) => setCommand(index, at, { command: e.target.value })}
                                            aria-label={t("adm_deliveryCommands")}
                                            className="min-w-[12rem] flex-1 font-mono text-xs"
                                            maxLength={1000}
                                        />
                                        <RowActions
                                            actions={[{ icon: Trash2, label: t("adm_variantRemoveCommand"), onClick: () => update(index, { commands: draft.commands.filter((_, i) => i !== at) }), destructive: true }]}
                                        />
                                    </div>
                                ))}
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => update(index, { commands: [...draft.commands, { command: "", serverId: "", target: "server", whenOnline: true }] })}
                                >
                                    <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t("adm_variantAddCommand")}
                                </Button>
                            </div>

                            <CheckboxField
                                checked={draft.isActive}
                                onChange={(e) => update(index, { isActive: e.target.checked })}
                                label={t("adm_variantActive")}
                            />
                        </div>
                    );
                })}
                <Button type="button" variant="outline" onClick={() => onChange([...value, emptyVariant()])}>
                    <Plus className="h-4 w-4" aria-hidden="true" /> {t("adm_variantAdd")}
                </Button>
            </CardContent>
        </Card>
    );
}
