"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";
import {
    Badge, Button, Card, CardContent, Checkbox, ListControls,
    Pagination, useConfirm, useLocalDateTime, useRowPicks,
} from "@/core/sdk/ui";
import { deleteEach } from "@/core/sdk";
import { AdminPageHeader, BulkBar, FilterChips, RowActions } from "@/core/sdk/admin";
import { ChevronDown, ChevronUp, FileText, Loader2, Trash2 } from "lucide-react";
import { SUBMISSION_STATES, type SubmissionState } from "../../../lib/validations";

/**
 * What people sent in, and what was done about it.
 *
 * This was a list and one dropdown. Every submission ever made, newest first,
 * fifty at a time, narrowed by nothing but which form - so finding the
 * message somebody is asking about meant paging until it appeared. A row
 * carried a state badge that no endpoint in the module could write, so the
 * word a row was created with was the word it kept; two of the three had no
 * translation, and a Turkish screen read "handled" and "read" beside a "Yeni"
 * that had been given one. Nothing could be deleted.
 *
 * And the first line of every row was three things printed one after another
 * with nothing between them, so it read "Report a bug12.09.2026 20:32:43Yeni".
 *
 * A submission is a message from a person. So: the state is one an operator
 * moves, the answers are shown under the questions that were asked rather
 * than under the column names they are stored in, and the list can be
 * searched for what somebody actually wrote.
 */

interface Field {
    name: string;
    type: string;
    label: string;
}

interface Form {
    id: string;
    title: string;
    slug: string;
    fields?: Field[];
}

interface Submission {
    id: string;
    formId: string;
    userId: string | null;
    /** The sender's name, where the id still resolves to a member. */
    sentBy: string | null;
    data: Record<string, unknown>;
    status: string;
    createdAt: string;
    form: Form;
}

/** The state each row's button moves it to, and what that button says. */
const NEXT_STATE: Record<SubmissionState, { to: SubmissionState; key: string }> = {
    new: { to: "read", key: "adm_markRead" },
    read: { to: "handled", key: "adm_markHandled" },
    handled: { to: "new", key: "adm_markNew" },
};

export default function SubmissionsPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("customForms");
    const commonT = useTranslations("common");
    // `common_selectRow` is core's word for this and three other screens
    // already use it; the forms module has no business owning a second one.
    const adminT = useTranslations("admin");
    const { confirm } = useConfirm();

    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [forms, setForms] = useState<Form[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [filterForm, setFilterForm] = useState("");
    const [filterState, setFilterState] = useState("");
    const [search, setSearch] = useState("");
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    // The endpoint pages this list, so only the ticking is the screen's: the
    // count on the button is a promise about the rows in front of the reader.
    const picks = useRowPicks(submissions);

    const fetchForms = useCallback(async () => {
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
    }, [commonT]);

    const fetchSubmissions = useCallback(async () => {
        setLoading(true);
        const params = new URLSearchParams({ page: String(page), limit: "50" });
        if (filterForm) params.set("formId", filterForm);
        if (filterState) params.set("status", filterState);
        if (search.trim()) params.set("q", search.trim());

        // A rejected fetch used to skip the setLoading(false) below it, so a
        // dropped connection left the spinner turning for good; a non-ok
        // response cleared it but left the list empty, which reads as "nobody
        // has filled this form in" rather than "this did not load".
        try {
            const res = await fetch(`/api/v1/forms/submissions?${params}`);
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setSubmissions(data.submissions || []);
            setCounts(data.counts || {});
            setTotal(data.total || 0);
            setTotalPages(data.pages || 1);
        } catch {
            toast.error(commonT("loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [page, filterForm, filterState, search, commonT]);

    useEffect(() => { fetchForms(); }, [fetchForms]);
    useEffect(() => { fetchSubmissions(); }, [fetchSubmissions]);

    const stateName = (status: string): string => {
        const key = `adm_state_${status}`;
        return t.has(key) ? t(key) : status;
    };

    /** The question a field asked, where the form still declares it. */
    const fieldLabel = (form: Form, name: string): string =>
        form.fields?.find((field) => field.name === name)?.label
            // A form edited since this was sent may no longer have the field.
            // The name is then all anybody has, so it is tidied rather than
            // hidden: an answer with no question above it is worse.
            ?? name.replace(/_/g, " ");

    /**
     * The answer, as the person gave it.
     *
     * A tick is stored as the string "true", because that is what the public
     * renderer produces for a checkbox and what the schema accepts. It is a
     * value, not a word, and the operator reading the submission was being
     * shown it.
     */
    const fieldValue = (form: Form, name: string, value: unknown): string => {
        const field = form.fields?.find((f) => f.name === name);
        const raw = String(value);
        if (field?.type !== "checkbox") return raw;
        return raw === "true" ? t("adm_answerYes") : t("adm_answerNo");
    };

    const move = async (sub: Submission) => {
        const next = NEXT_STATE[sub.status as SubmissionState] ?? NEXT_STATE.new;
        const res = await fetch(`/api/v1/forms/submissions/${sub.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: next.to }),
        });
        if (!res.ok) {
            toast.error(t("adm_stateFailed"));
            return;
        }
        toast.success(t("adm_stateChanged", { state: stateName(next.to) }));
        fetchSubmissions();
    };

    const remove = async (sub: Submission) => {
        const ok = await confirm({
            title: t("adm_deleteSubmission"),
            message: t("adm_deleteSubmissionConfirm"),
            confirmText: commonT("delete"),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/forms/submissions/${sub.id}`, { method: "DELETE" });
        if (!res.ok) {
            toast.error(t("adm_deleteFailed"));
            return;
        }
        toast.success(t("adm_submissionDeleted"));
        fetchSubmissions();
    };

    const removeMany = async () => {
        const ok = await confirm({
            title: t("adm_deleteSubmission"),
            message: t("adm_deleteManyConfirm", { count: picks.picked.size }),
            confirmText: commonT("delete"),
            variant: "danger",
        });
        if (!ok) return;
        const { deleted, total: asked } = await deleteEach([...picks.picked], async (id) => {
            const res = await fetch(`/api/v1/forms/submissions/${id}`, { method: "DELETE" });
            return res.ok;
        });
        picks.clear();
        fetchSubmissions();
        if (deleted === asked) toast.success(t("adm_submissionDeleted"));
        else if (deleted === 0) toast.error(t("adm_deleteFailed"));
        else toast.error(t("adm_deletedPartly", { deleted, total: asked }));
    };

    const narrowed = filterForm !== "" || filterState !== "" || search.trim() !== "";

    return (
        <>
            <AdminPageHeader
                title={t("adm_formSubmissions")}
                description={t("adm_submissionsTotal", { count: total })}
            />

            <ListControls
                className="mb-4"
                search={{
                    value: search,
                    onChange: (term) => { setSearch(term); setPage(1); },
                    placeholder: t("adm_searchSubmissions"),
                }}
                filters={[{
                    id: "form",
                    label: t("adm_filterByForm"),
                    value: filterForm,
                    onChange: (value) => { setFilterForm(value); setPage(1); },
                    options: [
                        { value: "", label: t("adm_allForms") },
                        ...forms.map((f) => ({ value: f.id, label: f.title })),
                    ],
                }]}
            />

            {/* The counts come from a query over the whole table, not from the
                fifty rows on screen. */}
            <FilterChips
                className="mb-4"
                label={t("adm_stateFilter")}
                active={filterState}
                onSelect={(id) => { setFilterState(id); setPage(1); }}
                chips={[
                    { id: "", label: t("adm_allStates") },
                    ...SUBMISSION_STATES.map((state) => ({
                        id: state,
                        label: stateName(state),
                        count: counts[state],
                    })),
                ]}
            />

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : submissions.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                        {/* "Nobody has filled this in" and "nothing matches
                            what you typed" are different pieces of news. */}
                        <p className="text-muted-foreground">
                            {narrowed ? t("adm_noMatchingSubmissions") : t("adm_noSubmissions")}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <>
                    <BulkBar
                        className="mb-2 rounded-lg border border-border"
                        state={picks.headerState}
                        count={picks.picked.size}
                        onToggleAll={picks.toggleAll}
                        actions={
                            <Button variant="destructive" size="sm" onClick={removeMany}>
                                <Trash2 className="w-4 h-4" /> {commonT("delete")} {picks.picked.size}
                            </Button>
                        }
                    />
                    <div className="space-y-2">
                        {submissions.map((sub) => {
                            const open = expandedId === sub.id;
                            const next = NEXT_STATE[sub.status as SubmissionState] ?? NEXT_STATE.new;
                            return (
                                <Card key={sub.id}>
                                    <CardContent className="p-4">
                                        <div className="flex items-center gap-3">
                                            <Checkbox
                                                checked={picks.picked.has(sub.id)}
                                                onChange={() => picks.toggle(sub.id)}
                                                aria-label={adminT("common_selectRow")}
                                            />
                                            {/* Three things with room between
                                                them. They used to be printed
                                                one after another with nothing
                                                between, so the first line read
                                                "Report a bug12.09.2026Yeni". */}
                                            <button
                                                type="button"
                                                className="flex flex-1 min-w-0 items-center gap-3 text-left"
                                                aria-expanded={open}
                                                onClick={() => setExpandedId(open ? null : sub.id)}
                                            >
                                                <span className="font-medium text-foreground truncate">{sub.form.title}</span>
                                                <Badge tone={sub.status === "new" ? "info" : "neutral"}>
                                                    {stateName(sub.status)}
                                                </Badge>
                                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                                    {formatDateTime(sub.createdAt)}
                                                </span>
                                                {open
                                                    ? <ChevronUp className="ml-auto w-4 h-4 shrink-0" aria-hidden="true" />
                                                    : <ChevronDown className="ml-auto w-4 h-4 shrink-0" aria-hidden="true" />}
                                            </button>
                                            <RowActions
                                                actions={[
                                                    { icon: Trash2, label: t("adm_deleteSubmission"), onClick: () => remove(sub), destructive: true },
                                                ]}
                                            />
                                        </div>
                                        {open && (
                                            <div className="mt-3 pt-3 border-t border-border">
                                                <div className="overflow-x-auto">
                                                    <table className="w-full text-sm">
                                                        <tbody>
                                                            {Object.entries(sub.data).map(([key, value]) => (
                                                                <tr key={key} className="border-b border-border/50 last:border-0">
                                                                    <td className="py-1.5 pr-4 font-medium text-muted-foreground w-1/3">
                                                                        {fieldLabel(sub.form, key)}
                                                                    </td>
                                                                    <td className="py-1.5 text-foreground whitespace-pre-wrap">{fieldValue(sub.form, key, value)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                                    <Button size="sm" variant="outline" onClick={() => move(sub)}>
                                                        {t(next.key)}
                                                    </Button>
                                                    <span className="text-xs text-muted-foreground">
                                                        {sub.sentBy
                                                            ? t("adm_submittedBy", { name: sub.sentBy })
                                                            : sub.userId
                                                                ? t("adm_submittedByDeleted")
                                                                : t("adm_submittedAnonymously")}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>

                    <Pagination page={page} pages={totalPages} total={total} onPageChange={setPage} />
                </>
            )}
        </>
    );
}
