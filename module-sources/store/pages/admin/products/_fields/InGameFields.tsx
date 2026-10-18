"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, CheckboxField, Input, Label } from "@/core/sdk/ui";
import type { InGameValue } from "./in-game-payload";

/**
 * How a product or a shelf looks in a connected game.
 *
 * Shown in game only when the switch is on, and a product only when its shelf
 * is shown too. The icon is free text because each game reads it its own way:
 * Minecraft takes a material or an item model, another game a sprite name.
 */
interface Props {
    value: InGameValue;
    onChange: (next: InGameValue) => void;
    kind: "product" | "category";
}

export function InGameFields({ value, onChange, kind }: Props) {
    const t = useTranslations("store");
    const set = (patch: Partial<InGameValue>) => onChange({ ...value, ...patch });
    const id = (name: string) => `${kind}-${name}`;

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("adm_inGame")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t(kind === "product" ? "adm_inGameHintProduct" : "adm_inGameHintCategory")}</p>
            </CardHeader>
            <CardContent className="space-y-4">
                <CheckboxField
                    checked={value.showInGame}
                    onChange={(e) => set({ showInGame: e.target.checked })}
                    label={t("adm_showInGame")}
                />
                <div>
                    <Label htmlFor={id("gameTitle")}>{t("adm_gameTitle")}</Label>
                    <Input id={id("gameTitle")} maxLength={100} value={value.gameTitle} onChange={(e) => set({ gameTitle: e.target.value })} placeholder={t("adm_gameTitleHint")} />
                </div>
                <div>
                    <Label htmlFor={id("gameDescription")}>{t("adm_gameDescription")}</Label>
                    <Input id={id("gameDescription")} maxLength={500} value={value.gameDescription} onChange={(e) => set({ gameDescription: e.target.value })} placeholder={t("adm_gameDescriptionHint")} />
                </div>
                <div>
                    <Label htmlFor={id("gameIcon")}>{t("adm_gameIcon")}</Label>
                    <Input id={id("gameIcon")} maxLength={100} className="font-mono" value={value.gameIcon} onChange={(e) => set({ gameIcon: e.target.value })} placeholder="diamond_sword" />
                    <p className="mt-1 text-sm text-muted-foreground">{t("adm_gameIconHint")}</p>
                </div>
            </CardContent>
        </Card>
    );
}
