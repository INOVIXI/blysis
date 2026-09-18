"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Target } from "lucide-react";
import { useSiteCurrency, useLocalDate } from "@/core/sdk/ui";

interface GoalData {
    target: number;
    title: string;
    current: number;
    endDate: string | null;
}

export function PaymentGoalWidget() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const sidebarT = useTranslations('sidebar');
    const { format: formatPrice } = useSiteCurrency();
    const [goal, setGoal] = useState<GoalData | null>(null);

    useEffect(() => {
        // Fetch goal settings and current revenue
        Promise.all([
            fetch("/api/v1/community-goal").then((r) => r.ok ? r.json() : null),
        ]).then(([goalData]) => {
            if (goalData) setGoal(goalData);
        }).catch(() => {});
    }, []);

    if (!goal || goal.target <= 0) return null;

    const percent = Math.min(100, Math.round((goal.current / goal.target) * 100));

    return (
        <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
                <Target className="w-4 h-4 text-primary" />
                <h2 className="font-bold text-foreground">{goal.title || sidebarT('paymentGoal')}</h2>
            </div>

            <div className="h-4 bg-muted rounded-full overflow-hidden mb-2 relative">
                <div
                    className="h-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500 rounded-full"
                    style={{ width: `${percent}%` }}
                />
                {percent > 10 && (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">
                        {percent}%
                    </span>
                )}
            </div>

            <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{formatPrice(goal.current)}</span>
                <span className="text-muted-foreground">{formatPrice(goal.target)}</span>
            </div>

            {goal.endDate && (
                <p className="text-xs text-muted-foreground mt-2 text-center">
                    {sidebarT('endsOn', { date: formatDate(goal.endDate) })}
                </p>
            )}

            {percent >= 100 && (
                <div className="mt-2 text-center text-xs font-bold text-success bg-success/10 rounded py-1">
                    {sidebarT('goalReached')}
                </div>
            )}
        </div>
    );
}
