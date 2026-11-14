"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Card, CardContent, LoadFailed } from "@/core/sdk/ui";
import { ArrangedClientPage } from "@/core/sdk/layout";
import { Loader2 } from "lucide-react";
import { errorMessage } from "@/core/sdk";
import { CrateCard, type Crate, type OpenedReward } from "./CrateCard";
import { OpeningHistory } from "./OpeningHistory";

/** How long the reveal plays before the reward is shown. */
const REVEAL_MS = 1200;

/**
 * The crates a site runs, what is in each and how likely it is, and what this
 * member has opened.
 *
 * The page never decides an outcome: it asks the server to open the crate,
 * waits out a short reveal and then shows what the server drew. A reader who
 * asked their system for reduced motion gets the answer the moment it
 * arrives, with nothing moving.
 */
export default function CratesPage() {
    const t = useTranslations("crates");
    const commonT = useTranslations("common");
    const { data: session } = useSession();

    const [crates, setCrates] = useState<Crate[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [opening, setOpening] = useState<string | null>(null);
    const [result, setResult] = useState<{ slug: string; reward: OpenedReward } | null>(null);
    const [refused, setRefused] = useState<{ slug: string; message: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/crates/crates")
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d) => {
                if (cancelled) return;
                setCrates(d.crates ?? []);
                setFailed(false);
                setLoading(false);
            })
            .catch(() => { if (!cancelled) { setFailed(true); setLoading(false); } });
        return () => { cancelled = true; };
    }, [reloadKey]);

    const open = async (crate: Crate, pay: "key" | "credits") => {
        if (opening) return;
        setOpening(crate.slug);
        setResult(null);
        setRefused(null);
        try {
            const res = await fetch(`/api/v1/crates/open?crate=${encodeURIComponent(crate.slug)}&pay=${pay}`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) {
                const key = `refusal_${String(data.code ?? "").replace(/^crate_/, "")}`;
                setRefused({ slug: crate.slug, message: t.has(key) ? t(key) : errorMessage(data, commonT("somethingWentWrong"), commonT) });
                setOpening(null);
                return;
            }
            const reveal = () => {
                setResult({ slug: crate.slug, reward: data.opening.reward });
                setOpening(null);
                setReloadKey((k) => k + 1);
            };
            const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (still) reveal();
            else window.setTimeout(reveal, REVEAL_MS);
        } catch {
            setRefused({ slug: crate.slug, message: commonT("somethingWentWrong") });
            setOpening(null);
        }
    };

    const waiting = loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-hidden="true" /></div>
    ) : failed ? (
        <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
    ) : crates.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t("noCrates")}</CardContent></Card>
    ) : null;

    if (waiting) {
        return (
            <ArrangedClientPage page="crates.crates" frame={{ title: t("title"), description: t("description") }} blocks={{}}>
                {waiting}
            </ArrangedClientPage>
        );
    }

    return (
        <ArrangedClientPage
            page="crates.crates"
            frame={{ title: t("title"), description: t("description") }}
            blocks={{
                crates: () => (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {crates.map((crate) => (
                            <CrateCard
                                key={crate.id}
                                crate={crate}
                                opening={opening === crate.slug}
                                result={result?.slug === crate.slug ? result.reward : null}
                                refused={refused?.slug === crate.slug ? refused.message : null}
                                onOpen={(pay) => { void open(crate, pay); }}
                            />
                        ))}
                    </div>
                ),
                history: () => (session?.user
                    ? <OpeningHistory refreshKey={reloadKey} />
                    : (
                        <div className="bg-card rounded-xl border border-border p-5 text-sm text-muted-foreground">
                            {t("historySignIn")}
                        </div>
                    )),
            }}
        />
    );
}
