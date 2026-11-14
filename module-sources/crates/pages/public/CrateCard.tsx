"use client";

import { useTranslations } from "next-intl";
import { Badge, Button, Card, CardContent } from "@/core/sdk/ui";
import { Coins, KeyRound, Loader2, Package, PackageOpen } from "lucide-react";
import { cn } from "@/core/sdk";
import { rarityTone } from "../../lib/crates";

export interface CrateReward {
    id: string;
    name: string;
    kind: string;
    value: number;
    rarity: string;
    chance: number;
}

export interface Crate {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    image: string | null;
    cost: number;
    sellsKeys: boolean;
    perPersonLimit: number;
    perPersonPeriod: string;
    restricted: boolean;
    keys: number;
    openedInWindow: number;
    /** Whether this reader may open it now with a key, and with credits. */
    canKey: boolean;
    canCredits: boolean;
    /** Why they cannot, for the way they would pay by default. */
    refusal: string | null;
    rewards: CrateReward[];
}

export interface OpenedReward {
    name: string;
    kind: string;
    value: number;
    rarity: string;
}

interface CrateCardProps {
    crate: Crate;
    /** True while the request is out or the reveal is playing. */
    opening: boolean;
    /** The reward that just came out of this crate, once revealed. */
    result: OpenedReward | null;
    refused: string | null;
    onOpen: (pay: "key" | "credits") => void;
}

/**
 * One crate: what is in it and how likely each thing is, how to pay for it and
 * what came out of the last opening.
 *
 * The odds table is the first thing under the name, before the button: a
 * member decides whether a crate is worth opening from it, so it is not
 * folded away behind a link.
 *
 * The reveal is a short shake while the request is out and a fade as the
 * reward appears, both `motion-safe` only. With reduced motion asked for the
 * page skips the wait as well, so the reward is shown the moment it is known.
 */
export function CrateCard({ crate, opening, result, refused, onOpen }: CrateCardProps) {
    const t = useTranslations("crates");

    const refusalText = crate.refusal && t.has(`refusal_${crate.refusal}`) ? t(`refusal_${crate.refusal}`) : null;

    return (
        <Card>
            <CardContent className="p-5 space-y-4">
                <div className="flex items-start gap-4">
                    {crate.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={crate.image} alt="" className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                        <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Package className="w-8 h-8 text-primary" aria-hidden="true" />
                        </div>
                    )}
                    <div className="min-w-0 space-y-1">
                        <h2 className="text-lg font-bold text-foreground">{crate.name}</h2>
                        {crate.description && <p className="text-sm text-muted-foreground">{crate.description}</p>}
                        <div className="flex flex-wrap gap-2 pt-1">
                            {crate.cost > 0 && <Badge tone="info">{t("costCredits", { count: crate.cost })}</Badge>}
                            {crate.sellsKeys && <Badge tone="neutral">{t("keysHeld", { count: crate.keys })}</Badge>}
                            {crate.perPersonLimit > 0 && (
                                <Badge tone="neutral">
                                    {t(`limit_${crate.perPersonPeriod}`, { used: crate.openedInWindow, limit: crate.perPersonLimit })}
                                </Badge>
                            )}
                            {crate.restricted && <Badge tone="warning">{t("membersOnly")}</Badge>}
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <caption className="text-left font-semibold text-foreground pb-2">{t("oddsTitle")}</caption>
                        <thead className="sr-only">
                            <tr>
                                <th scope="col">{t("oddsReward")}</th>
                                <th scope="col">{t("oddsChance")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {crate.rewards.map((reward) => (
                                <tr key={reward.id} className="border-t border-border">
                                    <td className="py-1.5 pr-3">
                                        <span className="flex items-center gap-2">
                                            <Badge tone={rarityTone(reward.rarity)}>{t(`rarity_${reward.rarity}`)}</Badge>
                                            <span className="text-foreground">{reward.name}</span>
                                        </span>
                                    </td>
                                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                                        {t("chance", { chance: reward.chance })}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="flex flex-col items-center gap-3 pt-2">
                    <div
                        className={cn(
                            "w-20 h-20 rounded-2xl bg-muted flex items-center justify-center",
                            opening && "motion-safe:animate-bounce",
                        )}
                        aria-hidden="true"
                    >
                        {result ? <PackageOpen className="w-10 h-10 text-primary" /> : <Package className="w-10 h-10 text-muted-foreground" />}
                    </div>

                    <div aria-live="polite" className="min-h-6 text-center">
                        {result ? (
                            <div className="motion-safe:animate-fade-in space-y-1">
                                <p className="text-sm text-muted-foreground">{t("youGot")}</p>
                                <Badge tone={rarityTone(result.rarity)} className="text-base px-3 py-1">{result.name}</Badge>
                            </div>
                        ) : opening ? (
                            <p className="text-sm text-muted-foreground">{t("opening")}</p>
                        ) : refused ? (
                            <p role="alert" className="text-sm text-destructive">{refused}</p>
                        ) : null}
                    </div>

                    <div className="flex flex-wrap justify-center gap-2">
                        {crate.sellsKeys || crate.keys > 0 ? (
                            <Button onClick={() => onOpen("key")} disabled={opening || !crate.canKey}>
                                {opening ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <KeyRound className="w-4 h-4" aria-hidden="true" />}
                                {t("openWithKey")}
                            </Button>
                        ) : null}
                        {crate.cost > 0 ? (
                            <Button variant={crate.keys > 0 ? "outline" : "default"} onClick={() => onOpen("credits")} disabled={opening || !crate.canCredits}>
                                <Coins className="w-4 h-4" aria-hidden="true" />
                                {t("openForCredits", { count: crate.cost })}
                            </Button>
                        ) : null}
                    </div>
                    {refusalText && !crate.canKey && !crate.canCredits && !result && !refused && <p className="text-sm text-muted-foreground">{refusalText}</p>}
                </div>
            </CardContent>
        </Card>
    );
}
