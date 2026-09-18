"use client";

import { Card, CardContent } from "@/core/components/ui/card";
import { Activity as ActivityIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "@/core/lib/i18n/navigation";
import { useTranslations } from "next-intl";

interface CheckState { ok: boolean; enabled?: boolean }
interface HealthResponse {
    status: "ok" | "degraded" | "down";
    checks: {
        database: CheckState & { latencyMs?: number };
        redis: CheckState;
        emailQueue: CheckState & { pending: number; failed: number };
        scheduler: CheckState & { staleJobs: number };
    };
}

/**
 * Compact KPI card - single overall health status dot + latency hint.
 * Full breakdown lives on /admin/observability.
 */
export default function HealthSnapshotWidget() {
    const t = useTranslations("admin");
    const [data, setData] = useState<HealthResponse | null>(null);

    useEffect(() => {
        let active = true;
        const tick = () => {
            fetch("/api/health")
                .then((r) => r.json())
                .then((d: HealthResponse) => { if (active) setData(d); })
                .catch(() => undefined);
        };
        tick();
        const id = setInterval(tick, 15_000);
        return () => { active = false; clearInterval(id); };
    }, []);

    const status = data?.status;
    const statusColor =
        status === "ok" ? "text-success" :
        status === "degraded" ? "text-warning" :
        status === "down" ? "text-destructive" :
        "text-muted-foreground";
    const statusLabel =
        status === "ok" ? (t("health_ok")) :
        status === "degraded" ? (t("health_degraded")) :
        status === "down" ? (t("health_down")) :
        t("widget_loading");
    const latency = data?.checks?.database?.latencyMs;

    return (
        <Link href="/admin/observability" className="block h-full">
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            {t("widget_health")}
                        </span>
                        <ActivityIcon className={`w-4 h-4 ${statusColor}`} />
                    </div>
                    <div className={`text-2xl font-bold ${statusColor}`}>{statusLabel}</div>
                    {latency !== undefined && (
                        <div className="text-xs text-muted-foreground mt-1">{latency}ms</div>
                    )}
                </CardContent>
            </Card>
        </Link>
    );
}
