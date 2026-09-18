"use client";


import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { Card, CardContent, NativeSelect, Pagination, useLocalDateTime } from "@/core/sdk/ui";
import { Loader2, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { AdminPageHeader } from "@/core/sdk/admin";

interface Form {
    id: string;
    title: string;
    slug: string;
}

interface Submission {
    id: string;
    formId: string;
    userId: string | null;
    data: Record<string, unknown>;
    status: string;
    createdAt: string;
    form: Form;
}

export default function SubmissionsPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("customForms");
    const commonT = useTranslations("common");
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [forms, setForms] = useState<Form[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterForm, setFilterForm] = useState("");
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    const fetchForms = async () => {
        try {
            const res = await fetch("/api/v1/forms");
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setForms(data.forms || []);
        } catch {
            // The filter is a convenience, not the page. Losing it is worth
            // saying once, but not worth blocking the submissions below it.
            toast.error(commonT("loadFailed"));
        }
    };

    const fetchSubmissions = async () => {
        setLoading(true);
        const params = new URLSearchParams({ page: String(page), limit: "50" });
        if (filterForm) params.set("formId", filterForm);

        // A rejected fetch used to skip the setLoading(false) below it, so a
        // dropped connection left the spinner turning for good; a non-ok
        // response cleared it but left the list empty, which reads as "nobody
        // has filled this form in" rather than "this did not load".
        try {
            const res = await fetch(`/api/v1/forms/submissions?${params}`);
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setSubmissions(data.submissions || []);
            setTotal(data.total || 0);
            setTotalPages(data.pages || 1);
        } catch {
            toast.error(commonT("loadFailed"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchForms(); }, []);
    useEffect(() => { fetchSubmissions(); }, [filterForm, page]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <>
            <AdminPageHeader
                title={t("adm_formSubmissions")}
                description={t("adm_submissionsTotal", { count: total })}
            />

            {/* Filter by form */}
            <div className="flex gap-2 mb-4">
                <NativeSelect
                    value={filterForm}
                    onChange={(e) => { setFilterForm(e.target.value); setPage(1); }}
                    aria-label={t("adm_filterByForm")}
                >
                    <option value="">{t("adm_allForms")}</option>
                    {forms.map((f) => (
                        <option key={f.id} value={f.id}>{f.title}</option>
                    ))}
                </NativeSelect>
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : submissions.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                        <p className="text-muted-foreground">{t("adm_noSubmissions")}</p>
                    </CardContent>
                </Card>
            ) : (
                <>
                    <div className="space-y-2">
                        {submissions.map((sub) => (
                            <Card key={sub.id}>
                                <CardContent className="p-4">
                                    <button
                                        className="w-full flex items-center justify-between text-left"
                                        onClick={() => setExpandedId(expandedId === sub.id ? null : sub.id)}
                                    >
                                        <div>
                                            <span className="font-medium text-foreground">{sub.form.title}</span>
                                            <span className="text-xs text-muted-foreground">
                                                {formatDateTime(sub.createdAt)}
                                            </span>
                                            <span className={`text-xs px-1.5 py-0.5 rounded ${sub.status === "new" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                                                {sub.status === "new" ? t("adm_submissionNew") : sub.status}
                                            </span>
                                        </div>
                                        {expandedId === sub.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    </button>
                                    {expandedId === sub.id && (
                                        <div className="mt-3 pt-3 border-t border-border overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <tbody>
                                                    {Object.entries(sub.data).map(([key, value]) => (
                                                        <tr key={key} className="border-b border-border/50 last:border-0">
                                                            <td className="py-1.5 pr-4 font-medium text-muted-foreground capitalize w-1/3">{key.replace(/_/g, " ")}</td>
                                                            <td className="py-1.5 text-foreground">{String(value)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                            {sub.userId && (
                                                <p className="text-xs text-muted-foreground mt-2">{t("adm_userId", { id: sub.userId })}</p>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <Pagination page={page} pages={totalPages} onPageChange={setPage} />
                </>
            )}
        </>
    );
}
