"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import {
    Database, HardDrive, Cpu, Users, Puzzle, Clock,
    Loader2, RefreshCw, Activity,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { SystemMetrics } from "../components/system-metrics";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";

interface SystemData {
    database: { size: string; totalUsers: number; newUsersWeek: number; totalModules: number; enabledModules: number };
    disk: { total: string; used: string; free: string };
    system: {
        nodeVersion: string; platform: string; hostname: string;
        cpuCount: number; cpuModel: string; loadAvg: number[];
        totalMemoryGB: string; freeMemoryGB: string;
        processMemoryMB: { rss: number; heapUsed: number; heapTotal: number };
        uptimeHours: number;
    };
}

export default function SystemPage() {
    const t = useTranslations("admin");
    const [system, setSystem] = useState<SystemData | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        const sysRes = await fetch("/api/v1/admin/system").then((r) => r.ok ? r.json() : null);
        if (sysRes) setSystem(sysRes);
        setLoading(false);
    }, []);

     
    useEffect(() => { fetchData(); }, [fetchData]);

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
    if (!system) return <p className="text-muted-foreground text-center py-8">{t("system_failedToLoad")}</p>;

    const stats = [
        { label: t("system_databaseSize"), value: system.database.size, icon: Database, color: "text-primary" },
        { label: t("system_totalUsers"), value: system.database.totalUsers, icon: Users, color: "text-success" },
        { label: t("system_newUsers7d"), value: system.database.newUsersWeek, icon: Activity, color: "text-secondary" },
        { label: t("system_modules"), value: `${system.database.enabledModules}/${system.database.totalModules}`, icon: Puzzle, color: "text-warning" },
        { label: t("system_diskUsed"), value: system.disk.used, icon: HardDrive, color: "text-destructive" },
        { label: t("system_diskFree"), value: system.disk.free, icon: HardDrive, color: "text-success" },
        { label: t("system_cpuCores"), value: system.system.cpuCount, icon: Cpu, color: "text-primary" },
        { label: t("system_uptime"), value: `${system.system.uptimeHours}h`, icon: Clock, color: "text-warning" },
    ];

    return (
        <>
            <AdminPageHeader
                title={t("system_title")}
                description={`${system.system.hostname} - ${system.system.platform}`}
                actions={<>
                    <Button variant="outline" size="sm" onClick={fetchData}>
                        <RefreshCw className="w-4 h-4" /> {t("system_refresh")}
                    </Button>
                </>}
            />

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {stats.map((s) => (
                    <Card key={s.label}>
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{s.label}</span>
                                <s.icon className={`w-4 h-4 ${s.color}`} />
                            </div>
                            <div className="text-2xl font-bold">{s.value}</div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Process Memory */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">{t("system_processMemory")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">RSS</span>
                            <span className="font-medium">{system.system.processMemoryMB.rss} MB</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{t("system_heapUsed")}</span>
                            <span className="font-medium">{system.system.processMemoryMB.heapUsed} MB</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{t("system_heapTotal")}</span>
                            <span className="font-medium">{system.system.processMemoryMB.heapTotal} MB</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{t("system_systemTotal")}</span>
                            <span className="font-medium">{system.system.totalMemoryGB} GB</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{t("system_systemFree")}</span>
                            <span className="font-medium">{system.system.freeMemoryGB} GB</span>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">{t("system_systemInfo")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Node.js</span>
                            <span className="font-medium">{system.system.nodeVersion}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">CPU</span>
                            <span className="font-medium truncate max-w-[60%]">{system.system.cpuModel}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{t("system_loadAvg")}</span>
                            <span className="font-medium">{system.system.loadAvg.join(", ")}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{t("system_diskTotal")}</span>
                            <span className="font-medium">{system.disk.total}</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Request Metrics */}
            <div className="mt-8">
                <SystemMetrics />
            </div>
        </>
    );
}
