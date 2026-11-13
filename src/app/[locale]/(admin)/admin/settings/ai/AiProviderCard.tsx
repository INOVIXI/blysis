"use client";

import { useTranslations } from "next-intl";
import { Bot, Store } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Badge } from "@/core/components/ui/badge";
import { buttonClassName } from "@/core/components/ui/button";
import { Label } from "@/core/components/ui/label";
import { NativeSelect } from "@/core/components/ui/native-select";
import { Link } from "@/core/lib/i18n/navigation";
import type { AiProviderRow } from "./ai-screen-data";

interface AiProviderCardProps {
    providers: AiProviderRow[];
    /** The provider core asks right now, as the server resolved it. */
    active: string | null;
    chosen: string | null;
    onChoose: (id: string | null) => void;
}

/**
 * Which provider answers. With none installed the screen says so and points
 * at the marketplace; with several and none chosen it says every call is
 * refused, because that is what core does.
 */
export function AiProviderCard({ providers, active, chosen, onChoose }: AiProviderCardProps) {
    const t = useTranslations("admin");

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{t("ai_providerTitle")}</CardTitle>
                <CardDescription>{t("ai_providerHelp")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {providers.length === 0 ? (
                    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-4" data-testid="ai-no-provider">
                        <p className="text-sm text-muted-foreground">{t("ai_noProvider")}</p>
                        <Link href="/admin/modules" className={buttonClassName("outline", "sm")}>
                            <Store className="h-4 w-4" />
                            {t("ai_findProvider")}
                        </Link>
                    </div>
                ) : (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                        {providers.map((provider) => (
                            <li key={provider.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                                <Bot className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                <span className="font-medium">{provider.name}</span>
                                {!provider.enabled ? (
                                    <Badge>{t("ai_providerOff")}</Badge>
                                ) : !provider.configured ? (
                                    <Badge tone="warning">{t("ai_providerNeedsSetup")}</Badge>
                                ) : (
                                    <Badge tone="success">{t("ai_providerReady")}</Badge>
                                )}
                                {provider.id === active && <Badge tone="info">{t("ai_providerInUse")}</Badge>}
                            </li>
                        ))}
                    </ul>
                )}

                {providers.length > 1 && (
                    <div className="space-y-1.5">
                        <Label htmlFor="ai-provider-choice">{t("ai_providerChoice")}</Label>
                        <NativeSelect
                            id="ai-provider-choice"
                            value={chosen ?? ""}
                            onChange={(e) => onChoose(e.target.value || null)}
                        >
                            <option value="">{t("ai_providerNone")}</option>
                            {providers.map((provider) => (
                                <option key={provider.id} value={provider.id}>{provider.name}</option>
                            ))}
                        </NativeSelect>
                    </div>
                )}

                {providers.length > 1 && !active && (
                    <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-foreground">{t("ai_chooseOne")}</p>
                )}
            </CardContent>
        </Card>
    );
}
