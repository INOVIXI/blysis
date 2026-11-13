"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Badge,
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CheckboxField,
    Input,
    Label,
    ListControls,
    LoadFailed,
    Pagination,
    useConfirm,
    useFormRoute,
    useLocalDateTime,
    useRowList,
    useSiteCurrency,
    useSiteSettings,
} from "@/core/sdk/ui";
import { AdminPageHeader, RowActions } from "@/core/sdk/admin";
import { instantToWallClock, writeError } from "@/core/sdk";
import { campaignInstant, campaignRunning, MAX_BONUS_TIERS, overlapping, readTiers } from "../../../lib/credit-bonus";

/**
 * Credit bonus campaigns: a percent more credits on a top-up, for a limited
 * time, larger for a larger payment.
 *
 * The dates are typed on the shop's clock and turned into instants on the
 * server, the same as a product's sale window. Two campaigns may overlap,
 * because each payment takes the larger bonus, but the screen marks both so
 * an operator who did not mean it sees it before the buyers do.
 */

interface Campaign {
    id: string;
    name: string;
    startsAt: string;
    endsAt: string;
    isActive: boolean;
    tiers: unknown;
}

interface TierDraft {
    minAmount: string;
    percent: string;
}

interface Draft {
    name: string;
    startsAt: string;
    endsAt: string;
    isActive: boolean;
    tiers: TierDraft[];
}

const EMPTY: Draft = { name: "", startsAt: "", endsAt: "", isActive: true, tiers: [{ minAmount: "", percent: "" }] };

function asDates<T extends { startsAt: string; endsAt: string }>(row: T) {
    return { ...row, startsAt: new Date(row.startsAt), endsAt: new Date(row.endsAt) };
}

export default function CreditBonusPage() {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const when = useLocalDateTime({ dateStyle: "medium", timeStyle: "short" });
    const { format: money } = useSiteCurrency();
    const { settings } = useSiteSettings();
    const timeZone = (settings.site_timezone as string) || "UTC";
    const { confirm } = useConfirm();

    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    // The form is a screen at `?form=new` or `?form=<id>`, not a card above
    // the list of campaigns.
    const { showForm, editingId, openForm, closeForm } = useFormRoute();
    const [draft, setDraft] = useState<Draft>(EMPTY);
    // The name is what the card draws and what an operator remembers.
    const list = useRowList(campaigns, { text: (campaign) => [campaign.name], pageSize: 20 });

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const res = await fetch("/api/v1/store/admin/credit-bonus-campaigns");
            if (!res.ok) throw new Error("read");
            const body = await res.json();
            setCampaigns(Array.isArray(body.campaigns) ? body.campaigns : []);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    // Filled from the campaign the address names once the rows arrive, so a
    // reload of `?form=<id>` lands on the same edit rather than an empty form.
    useEffect(() => {
        const campaign = editingId ? campaigns.find((row) => row.id === editingId) : null;
        setDraft(campaign
            ? {
                name: campaign.name,
                startsAt: instantToWallClock(new Date(campaign.startsAt), timeZone),
                endsAt: instantToWallClock(new Date(campaign.endsAt), timeZone),
                isActive: campaign.isActive,
                tiers: readTiers(campaign.tiers).map((tier) => ({ minAmount: String(tier.minAmount), percent: String(tier.percent) })),
            }
            : EMPTY);
    }, [editingId, campaigns, timeZone]);

    const save = async () => {
        setBusy(true);
        try {
            const url = editingId
                ? `/api/v1/store/admin/credit-bonus-campaigns/${editingId}`
                : "/api/v1/store/admin/credit-bonus-campaigns";
            const res = await fetch(url, {
                method: editingId ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: draft.name.trim(),
                    startsAt: draft.startsAt,
                    endsAt: draft.endsAt,
                    isActive: draft.isActive,
                    tiers: draft.tiers.map((tier) => ({ minAmount: Number(tier.minAmount) || 0, percent: Number(tier.percent) || 0 })),
                }),
            });
            const wrong = await writeError(res, t("adm_creditBonusSaveFailed"), t);
            if (wrong) {
                toast.error(wrong);
                return;
            }
            toast.success(t("adm_creditBonusSaved"));
            await load();
            closeForm();
        } catch {
            toast.error(t("adm_creditBonusSaveFailed"));
        } finally {
            setBusy(false);
        }
    };

    const remove = async (campaign: Campaign) => {
        const sure = await confirm({ title: t("adm_creditBonusDelete"), message: t("adm_creditBonusDeleteConfirm", { name: campaign.name }) });
        if (!sure) return;
        const res = await fetch(`/api/v1/store/admin/credit-bonus-campaigns/${campaign.id}`, { method: "DELETE" });
        const wrong = await writeError(res, t("adm_creditBonusSaveFailed"), t);
        if (wrong) {
            toast.error(wrong);
            return;
        }
        toast.success(t("adm_creditBonusDeleted"));
        await load();
    };

    if (loading) {
        return <Card><CardContent className="py-10 text-center text-muted-foreground">{commonT("loading")}</CardContent></Card>;
    }

    const header = (
        <AdminPageHeader
            title={t("adm_creditBonusTitle")}
            description={t("adm_creditBonusSubtitle")}
            actions={showForm ? undefined : (
                <Button variant="outline" onClick={() => openForm()}>
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    {t("adm_creditBonusAdd")}
                </Button>
            )}
        />
    );
    if (failed) return <>{header}<Card><CardContent><LoadFailed onRetry={load} /></CardContent></Card></>;

    const clashes = new Set(overlapping(campaigns.map(asDates)));
    // The form's own clash, against what is saved, before the save. Read on
    // the shop's clock, as the server will read it.
    const draftStarts = draft.startsAt ? campaignInstant(draft.startsAt, timeZone) : null;
    const draftEnds = draft.endsAt ? campaignInstant(draft.endsAt, timeZone) : null;
    const draftClash = draft.isActive && draftStarts !== null && draftEnds !== null &&
        overlapping([
            ...campaigns.filter((row) => row.id !== editingId).map(asDates),
            { id: "draft", isActive: true, startsAt: draftStarts, endsAt: draftEnds },
        ]).includes("draft");
    const setTier = (index: number, next: TierDraft) =>
        setDraft({ ...draft, tiers: draft.tiers.map((tier, at) => (at === index ? next : tier)) });
    const now = new Date();

    if (showForm) {
        return (
            <>
                {header}
                <Card>
                    <CardHeader><CardTitle>{editingId ? t("adm_creditBonusEdit") : t("adm_creditBonusAdd")}</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                                <Label htmlFor="bonus-name">{t("adm_creditBonusName")}</Label>
                                <Input id="bonus-name" value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                            </div>
                            <div>
                                <Label htmlFor="bonus-starts">{t("adm_creditBonusStarts")}</Label>
                                <Input id="bonus-starts" type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
                            </div>
                            <div>
                                <Label htmlFor="bonus-ends">{t("adm_creditBonusEnds")}</Label>
                                <Input id="bonus-ends" type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">{t("adm_creditBonusZone", { zone: timeZone })}</p>

                        <div className="space-y-2">
                            <p className="text-sm font-medium">{t("adm_creditBonusTiers")}</p>
                            <p className="text-xs text-muted-foreground">{t("adm_creditBonusTiersHint")}</p>
                            {draft.tiers.map((tier, index) => (
                                <div key={index} className="flex items-end gap-2">
                                    <div className="flex-1">
                                        <Label htmlFor={`tier-${index}-min`}>{t("adm_creditBonusMinAmount")}</Label>
                                        <Input id={`tier-${index}-min`} type="number" min={0} step="0.01" value={tier.minAmount} onChange={(e) => setTier(index, { ...tier, minAmount: e.target.value })} />
                                    </div>
                                    <div className="flex-1">
                                        <Label htmlFor={`tier-${index}-percent`}>{t("adm_creditBonusPercent")}</Label>
                                        <Input id={`tier-${index}-percent`} type="number" min={1} max={500} step={1} value={tier.percent} onChange={(e) => setTier(index, { ...tier, percent: e.target.value })} />
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        aria-label={t("adm_creditBonusRemoveTier")}
                                        disabled={draft.tiers.length <= 1}
                                        onClick={() => setDraft({ ...draft, tiers: draft.tiers.filter((_, at) => at !== index) })}
                                    >
                                        <X className="w-4 h-4" aria-hidden="true" />
                                    </Button>
                                </div>
                            ))}
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={draft.tiers.length >= MAX_BONUS_TIERS}
                                onClick={() => setDraft({ ...draft, tiers: [...draft.tiers, { minAmount: "", percent: "" }] })}
                            >
                                <Plus className="w-4 h-4" aria-hidden="true" />
                                {t("adm_creditBonusAddTier")}
                            </Button>
                        </div>

                        <CheckboxField
                            label={t("adm_creditBonusActive")}
                            checked={draft.isActive}
                            onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                        />

                        {draftClash && (
                            <p className="text-sm text-warning flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                                {t("adm_creditBonusOverlap")}
                            </p>
                        )}

                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" disabled={busy} onClick={closeForm}>{commonT("cancel")}</Button>
                            <Button disabled={busy || draft.name.trim() === ""} onClick={save}>
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
                                {t("adm_creditBonusSave")}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </>
        );
    }

    return (
        <>
            {header}

            <ListControls className="mb-4" search={{ value: list.search, onChange: list.setSearch }} />

            {campaigns.length === 0 ? (
                <Card><CardContent className="py-10 text-center text-muted-foreground">{t("adm_creditBonusNone")}</CardContent></Card>
            ) : list.rows.length === 0 ? (
                <Card><CardContent className="py-10 text-center text-muted-foreground">{commonT("noResults")}</CardContent></Card>
            ) : (
                <div className="space-y-3">
                    {list.rows.map((campaign) => {
                        const dated = asDates(campaign);
                        const state = !campaign.isActive
                            ? "off"
                            : campaignRunning(dated, now) ? "running" : dated.startsAt > now ? "scheduled" : "ended";
                        return (
                            <Card key={campaign.id} className={clashes.has(campaign.id) ? "border-warning/40" : ""}>
                                <CardContent className="py-4 space-y-2">
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <p className="font-medium flex items-center gap-2">
                                            {campaign.name}
                                            <Badge tone={state === "running" ? "success" : state === "scheduled" ? "info" : "neutral"}>
                                                {t(`adm_creditBonusState_${state}`)}
                                            </Badge>
                                        </p>
                                        <RowActions
                                            actions={[
                                                { icon: Pencil, label: t("adm_creditBonusEdit"), onClick: () => openForm(campaign.id) },
                                                { icon: Trash2, label: t("adm_creditBonusDelete"), onClick: () => void remove(campaign), destructive: true },
                                            ]}
                                        />
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        {t("adm_creditBonusWindow", { starts: when(campaign.startsAt), ends: when(campaign.endsAt) })}
                                    </p>
                                    <p className="text-sm">
                                        {readTiers(campaign.tiers)
                                            .map((tier) => t("adm_creditBonusTierLine", { amount: money(tier.minAmount), percent: tier.percent }))
                                            .join(" · ")}
                                    </p>
                                    {clashes.has(campaign.id) && (
                                        <p className="text-sm text-warning flex items-center gap-2">
                                            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                                            {t("adm_creditBonusOverlap")}
                                        </p>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                    <Pagination page={list.page} pages={list.pages} total={list.total} onPageChange={list.setPage} />
                </div>
            )}
        </>
    );
}
