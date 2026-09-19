"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus, Power, Save, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Badge,
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Input,
    Label,
    ListControls,
    LoadFailed,
    useConfirm,
    useRowList,
    useSiteCurrency,
} from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";
import { dateLocaleTag, writeError } from "@/core/sdk";
import { creditsPerUnit, poorValue, type PricedPackage } from "../../../lib/credit-package-value";

/**
 * The packages an operator sells credits in.
 *
 * Three numbers are typed and a fourth is what matters: what a credit costs
 * once the bonus is counted. The screen works that out per row and marks the
 * packages a cheaper one beats, because a ladder where paying more gets you
 * less is the mistake this list produces on its own and nobody notices from
 * the three numbers alone.
 *
 * A package is switched off rather than deleted. Its id is on every payment
 * that bought it, and a settlement arriving after the row is gone would have
 * nothing to name.
 */

interface Package extends PricedPackage {
    name: string;
    order: number;
}

type Draft = {
    name: string;
    credits: string;
    bonusCredits: string;
    price: string;
    order: string;
};

const EMPTY: Draft = { name: "", credits: "", bonusCredits: "0", price: "", order: "0" };

function draftOf(pack: Package): Draft {
    return {
        name: pack.name,
        credits: String(pack.credits),
        bonusCredits: String(pack.bonusCredits),
        price: String(pack.price),
        order: String(pack.order),
    };
}

/** What the endpoint takes. Empty boxes are zero, not NaN. */
function payload(draft: Draft) {
    return {
        name: draft.name.trim(),
        credits: Number(draft.credits) || 0,
        bonusCredits: Number(draft.bonusCredits) || 0,
        price: Number(draft.price) || 0,
        order: Number(draft.order) || 0,
    };
}

export default function CreditPackagesPage() {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    // The site's locale, not the browser's: a thousands separator is a
    // different character in each and the operator picked one.
    const localeTag = dateLocaleTag(useLocale());
    const { format: money } = useSiteCurrency();
    const { confirm } = useConfirm();

    const [packages, setPackages] = useState<Package[]>([]);
    // The lines the row draws. This list grows and paging to a row was the
    // only way to reach one.
    const list = useRowList(packages, { text: (row) => [row.name], pageSize: 20 });
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [fresh, setFresh] = useState<Draft>(EMPTY);
    const [adding, setAdding] = useState(false);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const res = await fetch("/api/v1/store/admin/credit-packages");
            if (!res.ok) throw new Error("read");
            const body = await res.json();
            const rows: Package[] = body.packages ?? [];
            setPackages(rows);
            setDrafts(Object.fromEntries(rows.map((row) => [row.id, draftOf(row)])));
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const flagged = new Set(poorValue(packages));

    const send = async (url: string, method: string, body: unknown, message: string) => {
        setBusy(url);
        try {
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const wrong = await writeError(res, t("adm_creditPackSaveFailed"), t);
            if (wrong) {
                toast.error(wrong);
                return false;
            }
            toast.success(message);
            await load();
            return true;
        } catch {
            toast.error(t("adm_creditPackSaveFailed"));
            return false;
        } finally {
            setBusy(null);
        }
    };

    if (loading) {
        return <Card><CardContent className="py-10 text-center text-muted-foreground">{commonT("loading")}</CardContent></Card>;
    }
    if (failed) {
        return (
            <>
                <AdminPageHeader title={t("adm_creditPackTitle")} description={t("adm_creditPackSubtitle")} />
                <Card><CardContent><LoadFailed onRetry={load} /></CardContent></Card>
            </>
        );
    }

    const numbers = (draft: Draft, onChange: (draft: Draft) => void, prefix: string) => (
        <div className="grid sm:grid-cols-5 gap-3">
            <div className="sm:col-span-2">
                <Label htmlFor={`${prefix}-name`}>{t("adm_creditPackName")}</Label>
                <Input id={`${prefix}-name`} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
            </div>
            <div>
                <Label htmlFor={`${prefix}-credits`}>{t("adm_creditPackCredits")}</Label>
                <Input id={`${prefix}-credits`} type="number" min={1} value={draft.credits} onChange={(e) => onChange({ ...draft, credits: e.target.value })} />
            </div>
            <div>
                <Label htmlFor={`${prefix}-bonus`}>{t("adm_creditPackBonus")}</Label>
                <Input id={`${prefix}-bonus`} type="number" min={0} value={draft.bonusCredits} onChange={(e) => onChange({ ...draft, bonusCredits: e.target.value })} />
            </div>
            <div>
                <Label htmlFor={`${prefix}-price`}>{t("adm_creditPackPrice")}</Label>
                <Input id={`${prefix}-price`} type="number" min={0} step="0.01" value={draft.price} onChange={(e) => onChange({ ...draft, price: e.target.value })} />
            </div>
        </div>
    );

    return (
        <>
            <AdminPageHeader
                title={t("adm_creditPackTitle")}
                description={t("adm_creditPackSubtitle")}
                actions={
                    <Button variant="outline" onClick={() => setAdding(!adding)}>
                        <Plus className="w-4 h-4" aria-hidden="true" />
                        {t("adm_creditPackAdd")}
                    </Button>
                }
            />

            {adding && (
                <Card className="mb-6">
                    <CardHeader><CardTitle>{t("adm_creditPackAdd")}</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        {numbers(fresh, setFresh, "new")}
                        <div className="flex justify-end">
                            <Button
                                disabled={busy !== null || fresh.name.trim() === ""}
                                onClick={async () => {
                                    const done = await send(
                                        "/api/v1/store/admin/credit-packages",
                                        "POST",
                                        payload(fresh),
                                        t("adm_creditPackAdded"),
                                    );
                                    if (done) {
                                        setFresh(EMPTY);
                                        setAdding(false);
                                    }
                                }}
                            >
                                <Save className="w-4 h-4" aria-hidden="true" />
                                {t("adm_creditPackSave")}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <ListControls className="mb-4" search={{ value: list.search, onChange: list.setSearch }} />

            {packages.length === 0 ? (
                <Card><CardContent className="py-10 text-center text-muted-foreground">{t("adm_creditPackNone")}</CardContent></Card>
            ) : (
                <div className="space-y-4">
                    {list.rows.map((pack) => {
                        const draft = drafts[pack.id] ?? draftOf(pack);
                        const rate = creditsPerUnit(pack);
                        const url = `/api/v1/store/admin/credit-packages/${pack.id}`;
                        return (
                            <Card key={pack.id} className={flagged.has(pack.id) ? "border-warning/40" : ""}>
                                <CardHeader>
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <CardTitle className="flex items-center gap-2">
                                            {pack.name}
                                            {!pack.isActive && <Badge tone="neutral">{t("adm_creditPackOff")}</Badge>}
                                        </CardTitle>
                                        <p className="text-sm text-muted-foreground">
                                            {rate === null
                                                ? t("adm_creditPackNoRate")
                                                : t("adm_creditPackRate", {
                                                    credits: Math.round(rate).toLocaleString(localeTag),
                                                    price: money(1),
                                                })}
                                        </p>
                                    </div>
                                    {flagged.has(pack.id) && (
                                        <p className="text-sm text-warning flex items-center gap-2">
                                            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                                            {t("adm_creditPackPoorValue")}
                                        </p>
                                    )}
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {numbers(draft, (next) => setDrafts({ ...drafts, [pack.id]: next }), pack.id)}
                                    <div className="flex justify-end gap-2 flex-wrap">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={busy !== null}
                                            onClick={() => send(url, "PATCH", { isActive: !pack.isActive }, pack.isActive ? t("adm_creditPackTurnedOff") : t("adm_creditPackTurnedOn"))}
                                        >
                                            <Power className="w-4 h-4" aria-hidden="true" />
                                            {pack.isActive ? t("adm_creditPackTurnOff") : t("adm_creditPackTurnOn")}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={busy !== null || !pack.isActive}
                                            onClick={async () => {
                                                const sure = await confirm({
                                                    title: t("adm_creditPackRetire"),
                                                    message: t("adm_creditPackRetireConfirm"),
                                                });
                                                if (sure) await send(url, "DELETE", undefined, t("adm_creditPackRetired"));
                                            }}
                                        >
                                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                                            {t("adm_creditPackRetire")}
                                        </Button>
                                        <Button
                                            size="sm"
                                            disabled={busy !== null}
                                            onClick={() => send(url, "PATCH", payload(draft), t("adm_creditPackSaved"))}
                                        >
                                            {busy === url
                                                ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                                : <Save className="w-4 h-4" aria-hidden="true" />}
                                            {t("adm_creditPackSave")}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </>
    );
}
