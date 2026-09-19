"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { Card, CardContent } from "@/core/components/ui/card";
import { Checkbox } from "@/core/components/ui/checkbox";
import { Input } from "@/core/components/ui/input";
import { NativeSelect } from "@/core/components/ui/native-select";
import { Pagination } from "@/core/components/ui/pagination";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { errorMessage } from "@/core/lib/write-result";
import { Label } from "@/core/components/ui/label";
import { defaultLocale, localeNames, locales, type Locale } from "@/core/lib/i18n/config";
import { Entry, TranslationEntry } from "./TranslationEntry";

/**
 * Every string the site renders, and a box to change it in.
 *
 * The catalogue is thousands of keys and grows with every module installed,
 * so the screen is a search rather than a list: a page of keys at a time,
 * narrowed by what a string says, which module ships it, or whether anybody
 * has already changed it.
 *
 * The endpoint refuses an edit that would name a value the calling code never
 * passes, and says which name it objected to. Those refusals are shown as
 * sentences here rather than as codes, because the operator who typed the
 * brace is the one who can fix it.
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
};

/** What everything else is translated from. */
const SOURCE = defaultLocale;

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
    const [moduleId, setModuleId] = useState("");
    const [namespace, setNamespace] = useState("");
    const [onlyEdited, setOnlyEdited] = useState(false);
    const [onlyMissing, setOnlyMissing] = useState(false);
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
        modules: string[];
        namespaces: string[];
        locales: { locale: string; held: number; missing: number }[];
    }>({ modules: [], namespaces: [], locales: [] });

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
                setFacets({ modules: [], namespaces: [], locales: [] });
            }
        };
        loadFacets();
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        const params = new URLSearchParams({ page: String(page) });
        if (query) params.set("q", query);
        if (moduleId) params.set("module", moduleId);
        if (namespace) params.set("namespace", namespace);
        if (onlyEdited) params.set("custom", "1");
        params.set("locale", target);
        if (onlyMissing) params.set("missing", "1");
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
    }, [page, query, moduleId, namespace, onlyEdited, onlyMissing, target, t]);

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
            current.map((row) =>
                row.module === item.module && row.namespace === item.namespace && row.key === item.key
                    ? item
                    : row,
            ),
        );
    };

    const send = async (entry: Entry, method: "PATCH" | "DELETE", extra: Record<string, unknown>) => {
        try {
            const res = await fetch("/api/v1/admin/translations", {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    module: entry.module,
                    namespace: entry.namespace,
                    key: entry.key,
                    ...extra,
                }),
            });
            const body = (await res.json()) as ListResponse & { data?: { item: Entry } };
            if (!body.ok) {
                toast.error(explain(body));
                return false;
            }
            const item = (body.data as unknown as { item?: Entry })?.item;
            if (item) replace(item);
            toast.success(method === "PATCH" ? t("translations_saved") : t("translations_restored"));
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
            />

            <Card className="mb-6">
                <CardContent className="p-4 grid gap-3 md:grid-cols-4 md:items-end">
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
                        value={moduleId}
                        onChange={(event) => {
                            setModuleId(event.target.value);
                            setPage(1);
                        }}
                    >
                        <option value="">{t("translations_allModules")}</option>
                        {facets.modules.map((id) => (
                            <option key={id} value={id}>
                                {id}
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
                    {/*
                      * Which language is being worked in, and how far behind
                      * each one is - the question the old screen could not
                      * answer at all, because it showed every language on
                      * every row and you found out by scrolling.
                      */}
                    <div className="md:col-span-2">
                        <Label>{t("translations_workingIn")}</Label>
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
                    </div>
                    <label className="flex items-center gap-2 text-sm md:col-span-2">
                        <Checkbox
                            checked={onlyEdited}
                            onChange={(event) => {
                                setOnlyEdited(event.target.checked);
                                setPage(1);
                            }}
                        />
                        {t("translations_onlyEdited")}
                    </label>
                    <label className="flex items-center gap-2 text-sm md:col-span-2">
                        <Checkbox
                            checked={onlyMissing}
                            onChange={(event) => {
                                setOnlyMissing(event.target.checked);
                                setPage(1);
                            }}
                        />
                        {t("translations_onlyMissing")}
                    </label>
                </CardContent>
            </Card>

            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
                </div>
            ) : items.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        {onlyMissing ? t("translations_noneMissing") : t("translations_none")}
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {items.map((entry) => (
                        <TranslationEntry
                            key={`${entry.module}/${entry.namespace}/${entry.key}`}
                            entry={entry}
                            source={SOURCE}
                            target={target}
                            onSave={(values) => send(entry, "PATCH", { values })}
                            onRestore={async () => {
                                const sure = await confirm({
                                    title: t("translations_restore"),
                                    message: t("translations_restoreConfirm"),
                                });
                                if (!sure) return false;
                                return send(entry, "DELETE", {});
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
