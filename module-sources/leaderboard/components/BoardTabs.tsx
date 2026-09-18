"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Card, CardContent, ListControls, LoadFailed, SegmentedTabs, Waiting, useSiteCurrency } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";

interface Row {
    username: string;
    avatar: string | null;
    value: number;
    /** What the module that ordered the board says this row came. */
    rank: number;
}

interface Board {
    id: string;
    labelKey: string;
    icon: string;
    unit: "currency" | "count";
    rows: Row[];
}

/** Gold, silver, bronze, then nothing. */
const rankColours = ["text-warning", "text-muted-foreground", "text-warning"];

/**
 * The page shows the boards the install offers, whatever they are.
 *
 * It used to name three of them - buyers, voters, forum - and ask the
 * endpoint which of the three were available. The modules that own that data
 * now offer their own board, so a fourth arrives with its module and this file
 * does not change. The label comes with the board, as a full message key,
 * because it belongs to whoever offered it.
 */
/**
 * The boards, drawn from what the server already read.
 *
 * The tabs and the first board's rows used to be two fetches on mount, so the
 * HTML the server sent carried no name and no rank. The server reads both now;
 * switching tabs still asks the endpoint, which is the only part that needs a
 * browser.
 */
export function BoardTabs({ initialBoards, initialRows, initialId }: {
    initialBoards: Board[];
    initialRows: Row[];
    initialId: string | null;
}) {
    const t = useTranslations("leaderboard");
    const everything = useTranslations();
    const { format: formatPrice } = useSiteCurrency();

    const [boards] = useState<Board[]>(initialBoards);
    const [activeId, setActiveId] = useState<string | null>(initialId);
    const [rows, setRows] = useState<Row[]>(initialRows);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [search, setSearch] = useState("");
    const [period, setPeriod] = useState("");

    // And the rows of the one being looked at.
    /*
     * The first board is the one the server rendered, so asking for it again
     * would be a second read of the same rows. A ref rather than state: it
     * decides what the effect does and must not be why it runs.
     */
    const serverDrewThisBoard = useRef(true);

    useEffect(() => {
        if (!activeId) return;
        if (serverDrewThisBoard.current && search === "" && period === "") {
            serverDrewThisBoard.current = false;
            return;
        }
        serverDrewThisBoard.current = false;
        let cancelled = false;
        setLoading(true);
        const params = new URLSearchParams({ board: activeId, limit: "20" });
        if (search) params.set("q", search);
        if (period) params.set("period", period);
        fetch(`/api/v1/leaderboard?${params}`)
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d: { boards?: Board[] }) => {
                if (cancelled) return;
                setRows((d.boards ?? []).find((b) => b.id === activeId)?.rows ?? []);
                setFailed(false);
                setLoading(false);
            })
            .catch(() => { if (!cancelled) { setFailed(true); setLoading(false); } });
        return () => { cancelled = true; };
    }, [activeId, reloadKey, search, period]);

    const active = boards.find((b) => b.id === activeId) ?? null;

    return (
        <PageFrame title={t("title")} description={t("subtitle")}>
            {/* A board is a different list, not a narrower one, so it is a
                tab. One board is not a choice and draws no rail. */}
            {boards.length > 1 && (
                <SegmentedTabs
                    label={t("title")}
                    activeId={activeId ?? ""}
                    onChange={setActiveId}
                    className="mb-6"
                    tabs={boards.map((board) => ({
                        id: board.id,
                        label: everything(board.labelKey),
                        icon: board.icon,
                    }))}
                />
            )}

            <ListControls
                className="mb-6"
                search={{ value: search, onChange: setSearch, placeholder: t("searchMembers") }}
                filters={[{
                    id: "period",
                    label: t("period"),
                    value: period,
                    onChange: setPeriod,
                    options: [
                        { value: "", label: t("periodAll") },
                        { value: "week", label: t("periodWeek") },
                        { value: "month", label: t("periodMonth") },
                        { value: "year", label: t("periodYear") },
                    ],
                }]}
            />

            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <Waiting label={t("title")} />
                    ) : failed ? (
                        <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                    ) : rows.length === 0 ? (
                        <p className="text-muted-foreground text-center py-12">{t("noData")}</p>
                    ) : (
                        <div className="divide-y">
                            {rows.map((row, i) => (
                                <div key={`${row.username}-${i}`} className="flex items-center gap-4 p-4">
                                    {/* The rank the board gave it, not where it
                                        landed in the array: a searched row is
                                        still whatever it really came. */}
                                    <div className={`w-10 text-center font-bold text-lg ${rankColours[row.rank - 1] || "text-muted-foreground"}`}>
                                        #{row.rank}
                                    </div>
                                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-bold text-sm overflow-hidden">
                                        {row.avatar ? (
                                            <Image
                                                src={row.avatar}
                                                alt={row.username}
                                                width={40}
                                                height={40}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            row.username.charAt(0).toUpperCase()
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-medium">{row.username}</p>
                                    </div>
                                    <div className="text-right font-bold">
                                        {active?.unit === "currency" ? formatPrice(row.value) : row.value}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </PageFrame>
    );
}
