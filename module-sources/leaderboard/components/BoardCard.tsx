"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Trophy } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { SegmentedTabs, useSiteCurrency } from "@/core/sdk/ui";

interface Row {
    username: string;
    avatar: string | null;
    value: number;
    rank: number;
}

interface Board {
    id: string;
    labelKey: string;
    icon: string;
    unit: "currency" | "count";
}

/** The top of a board, not the board: the page has the rest. */
const SHOWN = 5;

/** Gold, silver, bronze, then nothing. */
const RANK_BADGES = [
    "bg-warning text-warning-foreground",
    "bg-muted-foreground/25 text-foreground",
    "bg-warning/40 text-foreground",
];

interface BoardCardProps {
    /** One board's id: shown alone, with no tabs. None offers every board. */
    only?: string;
    /** Said over the board in place of the board's or the widget's name. */
    title?: string;
}

/**
 * Who leads the site's boards over the last thirty days, for the homepage.
 *
 * The boards are whatever the installed modules offer through
 * `leaderboard.boards` - voters, buyers, posters - so this names none of them;
 * a board's label is a full message key that belongs to the module that
 * offered it. Thirty days rather than all time, because an all-time board on
 * a homepage is the same three names for ever.
 *
 * The widget draws every board; a theme's block may name one, which is then
 * asked for directly and drawn alone, and a board nobody offers draws nothing.
 */
export function BoardCard({ only, title }: BoardCardProps) {
    const t = useTranslations("leaderboard");
    const everything = useTranslations();
    const { format: formatPrice } = useSiteCurrency();
    const [boards, setBoards] = useState<Board[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [rows, setRows] = useState<Row[] | null>(null);
    // A homepage widget that could not read its board steps aside: "nobody
    // yet" is a claim about the site, and a refused read is not one.
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (only) {
            setActiveId(only);
            return;
        }
        let active = true;
        fetch("/api/v1/leaderboard")
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d: { boards?: Board[] }) => {
                if (!active || !Array.isArray(d.boards) || d.boards.length === 0) return;
                setBoards(d.boards);
                setActiveId(d.boards[0].id);
            })
            .catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [only]);

    useEffect(() => {
        if (!activeId) return;
        let active = true;
        const params = new URLSearchParams({ board: activeId, limit: String(SHOWN), period: "month" });
        fetch(`/api/v1/leaderboard?${params}`)
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d: { boards?: (Board & { rows?: Row[] })[] }) => {
                if (!active) return;
                const found = d.boards?.find((b) => b.id === activeId);
                // Named by a theme: the board is what this answer says it is.
                if (only) setBoards(found ? [found] : []);
                setRows(found?.rows ?? []);
                setFailed(false);
            })
            .catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [activeId, only]);

    if (failed || boards.length === 0 || !activeId) return null;
    const board = boards.find((b) => b.id === activeId) ?? boards[0];

    return (
        <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
                <Trophy className="w-4 h-4 text-primary" />
                <h2 className="font-bold text-foreground">
                    {title || (boards.length > 1 ? t("widget_title") : everything(board.labelKey))}
                </h2>
            </div>
            {boards.length > 1 && (
                <SegmentedTabs
                    label={t("widget_title")}
                    activeId={activeId}
                    onChange={setActiveId}
                    className="mb-4"
                    tabs={boards.map((b) => ({ id: b.id, label: everything(b.labelKey), icon: b.icon }))}
                />
            )}
            {rows && rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("widget_empty")}</p>
            ) : (
                <ol className="space-y-2.5">
                    {(rows ?? []).map((row) => (
                        <li key={`${row.rank}-${row.username}`} className="flex items-center gap-3">
                            <span className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-sm font-bold ${RANK_BADGES[row.rank - 1] ?? "bg-muted text-muted-foreground"}`}>
                                {row.rank}
                            </span>
                            <span className="flex-1 min-w-0 truncate font-medium text-foreground">{row.username}</span>
                            <span className="text-sm text-muted-foreground">
                                {board.unit === "currency" ? formatPrice(row.value) : row.value}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
            <Link href="/leaderboard" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
                {t("widget_all")}
            </Link>
        </div>
    );
}
