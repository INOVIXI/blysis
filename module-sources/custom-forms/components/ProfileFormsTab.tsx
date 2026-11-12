"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, LoadFailed, Pagination } from "@/core/sdk/ui";
import { Loader2 } from "lucide-react";
import { MySubmissions, type MySubmission } from "./MySubmissions";

/**
 * The member's own submissions, on their profile: every form they sent, where
 * each one stands and the note the team left them. An application that was
 * answered is otherwise news they could only get by opening the form again.
 */
export function ProfileFormsTab() {
    const t = useTranslations("customForms");
    const [rows, setRows] = useState<MySubmission[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/v1/forms/submissions/mine?page=${page}&limit=20`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((data) => {
                if (cancelled) return;
                setRows(data.submissions ?? []);
                setPages(data.pages || 1);
                setTotal(data.total ?? 0);
                setFailed(false);
            })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [page, attempt]);

    if (loading) {
        return (
            <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (failed) return <LoadFailed onRetry={() => setAttempt((n) => n + 1)} />;
    if (rows.length === 0) {
        return (
            <Card>
                <CardContent className="py-8 text-center text-muted-foreground">{t("noSubmissionsYet")}</CardContent>
            </Card>
        );
    }
    return (
        <div className="space-y-4">
            <MySubmissions submissions={rows} />
            <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
        </div>
    );
}
