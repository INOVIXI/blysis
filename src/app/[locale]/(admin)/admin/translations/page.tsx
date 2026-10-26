"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileUp, Loader2, Replace, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { Card, CardContent } from "@/core/components/ui/card";
import { buttonClassName } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { NativeSelect } from "@/core/components/ui/native-select";
import { Pagination } from "@/core/components/ui/pagination";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { errorMessage } from "@/core/lib/write-result";
import { defaultLocale, localeNames, locales, type Locale } from "@/core/lib/i18n/config";
import { Link } from "@/core/lib/i18n/navigation";
import { type Entry, type Source, TranslationEntry, useSourceLabel } from "./TranslationEntry";

/**
 * Every string the site renders, and a box to change it in.
 *
 * The catalogue is thousands of keys and grows with every module installed,
 * so the screen is a search rather than a list: a page of strings at a time,
 * narrowed by what a string says in any language, which source has a row for
 * it, or whether anybody has already changed it. A string is one line
 * whoever ships it, so the operator edits what a visitor reads.
 *
 * The endpoint refuses an edit that would name a value the calling code never
 * passes, and says which name it objected to. Those refusals are shown as
 * sentences here rather than as codes, because the operator who typed the
 * brace is the one who can fix it.
 *
 * Which strings are shown is one choice beside the language being worked in:
 * every one, what somebody changed, what the language is missing, what an
 * update changed under the site's edit, or what changed in another language
 * after this one was written. Four checkboxes in that row wrapped their labels
 * onto four lines each, and two of them together asked a question nobody has.
 */

interface ListResponse {
    ok: boolean;
    data?: { items: Entry[]; page: number; total: number; pages: number };
    error?: string;
    code?: string;
    details?: { locale?: string; names?: string[] };
}

const REFUSALS: Record<string, string> = {
    translation_new_placeholder: "translations_errNewPlaceholder",
    translation_malformed: "translations_errMalformed",
    translation_empty: "translations_errEmpty",
    translation_too_long: "translations_errTooLong",
    translation_no_shipped_value: "translations_errNoShipped",
    translation_not_custom: "translations_errNotCustom",
    translation_not_found: "translations_errNotFound",
    translation_history_not_found: "translations_errHistoryNotFound",
    translation_flag_not_found: "translations_errFlagNotFound",
};

/** What everything else is translated from. */
const SOURCE = defaultLocale;

/** Which strings are shown, and what each asks the endpoint for. */
const SHOWS = {
    all: { label: "translations_showAll", param: null },
    edited: { label: "translations_onlyEdited", param: "custom" },
    missing: { label: "translations_onlyMissing", param: "missing" },
    review: { label: "translations_onlyReview", param: "review" },
    awaiting: { label: "translations_onlyAwaiting", param: "awaiting" },
} as const;
type Show = keyof typeof SHOWS;

/** What every write to a string names it by. */
function nameOf(entry: Entry) {
    return { namespace: entry.namespace, key: entry.key };
}

export default function TranslationsPage() {
    const t = useTranslations("admin");
    const locale = useLocale();
    const { confirm } = useConfirm();

    const [items, setItems] = useState<Entry[]>([]);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);

    const [typed, setTyped] = useState("");
    const [query, setQuery] = useState("");
    const [source, setSource] = useState("");
    const [namespace, setNamespace] = useState("");
    const [show, setShow] = useState<Show>("all");
    /*
     * The language being worked in.
     *
     * The screen used to show every locale on every row, which is a sound
     * shape for two and an impossible one for twenty. It opens on the
     * language the operator is reading the panel in, because that is the one
     * they are most likely to be fixing - and on the source itself that would
     * be a column against itself, so it falls back to the other.
     */
    const [target, setTarget] = useState<Locale>(() =>
        locale !== SOURCE ? (locale as Locale) : (locales.find((l) => l !== SOURCE) ?? SOURCE));
    const [facets, setFacets] = useState<{
        sources: Source[];
        namespaces: string[];
        locales: { locale: string; held: number; missing: number }[];
    }>({ sources: [], namespaces: [], locales: [] });

    // Typing is not a request. Without this the endpoint runs a distinct
    // count over the whole catalogue on every keystroke.
    useEffect(() => {
        const timer = setTimeout(() => {
            setQuery(typed.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [typed]);

    useEffect(() => {
        // The two dropdowns are a convenience over the search box, so a
        // failure here leaves them holding only their "everything" option
        // rather than stopping the screen. The list below reports its own.
        const loadFacets = async () => {
            try {
                const res = await fetch("/api/v1/admin/translations/filters");
                const body = await res.json();
                if (body?.ok) setFacets(body.data);
            } catch {
                setFacets({ sources: [], namespaces: [], locales: [] });
            }
        };
        loadFacets();
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        const params = new URLSearchParams({ page: String(page) });
        if (query) params.set("q", query);
        if (source) params.set("module", source);
        if (namespace) params.set("namespace", namespace);
        params.set("locale", target);
        const only = SHOWS[show].param;
        if (only) params.set(only, "1");
        try {
            const res = await fetch(`/api/v1/admin/translations?${params}`);
            const body = (await res.json()) as ListResponse;
            if (!body.ok || !body.data) {
                toast.error(errorMessage(body, t("translations_errGeneric"), t));
                return;
            }
            setItems(body.data.items);
            setPages(body.data.pages);
            setTotal(body.data.total);
        } catch {
            toast.error(t("translations_errGeneric"));
        } finally {
            setLoading(false);
        }
    }, [page, query, source, namespace, show, target, t]);

    useEffect(() => {
        load();
    }, [load]);

    const explain = (body: ListResponse): string => {
        const key = body.code ? REFUSALS[body.code] : undefined;
        // The refusals this endpoint invents carry a locale and a name, which
        // `errorMessage` has no way to place into a sentence. Anything else
        // goes the ordinary way.
        if (!key) return errorMessage(body, t("translations_errGeneric"), t);
        return t(key, {
            locale: body.details?.locale ?? "",
            names: (body.details?.names ?? []).join(", "),
        });
    };

    const replace = (item: Entry) => {
        setItems((current) =>
            current.map((row) => (row.namespace === item.namespace && row.key === item.key ? item : row)),
        );
    };
    const labelOf = useSourceLabel(facets.sources);

    const send = async (path: string, method: "PATCH" | "DELETE" | "POST", payload: Record<string, unknown>, done: string) => {
        try {
            const res = await fetch(`/api/v1/admin/translations${path}`, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const body = (await res.json()) as ListResponse & { data?: { item: Entry } };
            if (!body.ok) {
                toast.error(explain(body));
                return false;
            }
            const item = (body.data as unknown as { item?: Entry })?.item;
            if (item) replace(item);
            toast.success(t(done));
            return true;
        } catch {
            toast.error(t("translations_errGeneric"));
            return false;
        }
    };

    return (
        <>
            <AdminPageHeader
                title={t("translations_title")}
                description={t("translations_description", { count: total })}
                actions={
                    <>
                        <Link href="/admin/translations/replace" className={buttonClassName("outline", "default")}>
                            <Replace className="w-4 h-4" aria-hidden="true" /> {t("translations_replaceOpen")}
                        </Link>
                        <Link href="/admin/translations/import" className={buttonClassName("outline", "default")}>
                            <FileUp className="w-4 h-4" aria-hidden="true" /> {t("translations_importOpen")}
                        </Link>
                        {/* A file, not a page: the endpoint answers with an attachment. */}
                        <a href="/api/v1/admin/translations/export" download className={buttonClassName("outline", "default")}>
                            <Download className="w-4 h-4" aria-hidden="true" /> {t("translations_export")}
                        </a>
                    </>
                }
            />

            <Card className="mb-6">
                <CardContent className="p-4 space-y-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="relative md:col-span-2">
                            <Search
                                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
                                aria-hidden="true"
                            />
                            <Input
                                className="pl-9"
                                value={typed}
                                aria-label={t("translations_search")}
                                placeholder={t("translations_search")}
                                onChange={(event) => setTyped(event.target.value)}
                            />
                    </div>
                    <NativeSelect
                        aria-label={t("translations_module")}
                        value={source}
                        onChange={(event) => {
                            setSource(event.target.value);
                            setPage(1);
                        }}
                    >
                        <option value="">{t("translations_allModules")}</option>
                        {facets.sources.map((row) => (
                            <option key={row.id} value={row.id}>
                                {labelOf(row.id)}
                            </option>
                        ))}
                    </NativeSelect>
                    <NativeSelect
                        aria-label={t("translations_namespace")}
                        value={namespace}
                        onChange={(event) => {
                            setNamespace(event.target.value);
                            setPage(1);
                        }}
                    >
                        <option value="">{t("translations_allNamespaces")}</option>
                        {facets.namespaces.map((name) => (
                            <option key={name} value={name}>
                                {name}
                            </option>
                        ))}
                    </NativeSelect>
                    </div>
                    {/*
                      * Which language is being worked in, and how far behind
                      * each one is - the question the old screen could not
                      * answer at all, because it showed every language on
                      * every row and you found out by scrolling.
                      */}
                    <div className="flex flex-col gap-3 md:flex-row md:items-center">
                        <label className="flex items-center gap-2 text-sm md:w-[calc(50%-0.375rem)] md:shrink-0">
                            <span className="shrink-0 text-muted-foreground">{t("translations_workingIn")}</span>
                            <NativeSelect
                                aria-label={t("translations_workingIn")}
                                value={target}
                                onChange={(event) => {
                                    setTarget(event.target.value as Locale);
                                    setPage(1);
                                }}
                            >
                                {locales.filter((l) => l !== SOURCE).map((l) => {
                                    const behind = facets.locales.find((row) => row.locale === l)?.missing;
                                    return (
                                        <option key={l} value={l}>
                                            {localeNames[l]}
                                            {behind === undefined ? "" : ` - ${t("translations_behind", { count: behind })}`}
                                        </option>
                                    );
                                })}
                            </NativeSelect>
                        </label>
                        <label className="flex items-center gap-2 text-sm md:flex-1">
                            <span className="shrink-0 text-muted-foreground">{t("translations_show")}</span>
                            <NativeSelect
                                aria-label={t("translations_show")}
                                value={show}
                                onChange={(event) => {
                                    setShow(event.target.value as Show);
                                    setPage(1);
                                }}
                            >
                                {(Object.keys(SHOWS) as Show[]).map((each) => (
                                    <option key={each} value={each}>
                                        {t(SHOWS[each].label)}
                                    </option>
                                ))}
                            </NativeSelect>
                        </label>
                    </div>
                </CardContent>
            </Card>

            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
                </div>
            ) : items.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        {show === "missing" ? t("translations_noneMissing") : t("translations_none")}
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {items.map((entry) => (
                        <TranslationEntry
                            key={`${entry.namespace}/${entry.key}`}
                            entry={entry}
                            labelOf={labelOf}
                            source={SOURCE}
                            target={target}
                            onSave={(values) => send("", "PATCH", { ...nameOf(entry), values }, "translations_saved")}
                            onRestore={async () => {
                                const sure = await confirm({
                                    title: t("translations_restore"),
                                    message: t("translations_restoreConfirm"),
                                });
                                if (!sure) return false;
                                return send("", "DELETE", nameOf(entry), "translations_restored");
                            }}
                            onAdopt={() => send("", "DELETE", { ...nameOf(entry), locale: target }, "translations_restored")}
                            onMark={(reason) => send("/flags", "POST", { ...nameOf(entry), locale: target, reason }, "translations_lookedAt")}
                            onUndo={async (version) => {
                                const sure = await confirm({
                                    title: t("translations_undo"),
                                    message: t("translations_undoConfirm"),
                                });
                                if (!sure) return false;
                                return send("/history", "POST", { id: version }, "translations_undone");
                            }}
                        />
                    ))}
                </div>
            )}

            {pages > 1 ? (
                <Pagination className="mt-6" page={page} pages={pages} total={total} onPageChange={setPage} />
            ) : null}
        </>
    );
}
