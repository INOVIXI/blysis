"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Checkbox,
    Input,
    Label,
    LoadFailed,
    Textarea,
} from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";
import { LIMITS, embedRefusal } from "../../../lib/embed-limits";
import { unknownPlaceholders } from "../../../lib/placeholder-check";

/**
 * Designing the message one event sends.
 *
 * Two things this screen exists to show before a message goes out at three in
 * the morning about somebody's order.
 *
 * The first is the total. Every box has its own limit and the service also has
 * one across all of them, so an operator can be inside every limit on the
 * screen and still have a message the service refuses with a bare 400. The
 * running count is against that total, not against the box.
 *
 * The second is a name the event does not carry. The send leaves an unknown
 * name in the message on purpose - a typo shows as `{palyer}` rather than a
 * gap - which is right and means the operator would find out from a channel.
 * The warning moves that to the form. It stays a warning: a brace somebody
 * meant to type is theirs to type.
 */

interface FieldDraft {
    name: string;
    value: string;
    inline: boolean;
}

interface Draft {
    isActive: boolean;
    webhookUrl: string;
    title: string;
    description: string;
    footer: string;
    fields: FieldDraft[];
}

interface KnownEvent {
    event: string;
    labelKey: string;
    placeholders: string[];
    message: {
        isActive: boolean;
        webhookUrl: string | null;
        title: string | null;
        description: string | null;
        footer: string | null;
        fields: FieldDraft[] | null;
    } | null;
}

const EMPTY: Draft = { isActive: true, webhookUrl: "", title: "", description: "", footer: "", fields: [] };

function toDraft(event: KnownEvent): Draft {
    const message = event.message;
    if (!message) return { ...EMPTY, fields: [] };
    return {
        isActive: message.isActive,
        webhookUrl: message.webhookUrl ?? "",
        title: message.title ?? "",
        description: message.description ?? "",
        footer: message.footer ?? "",
        fields: (message.fields ?? []).map((field) => ({
            name: field.name ?? "",
            value: field.value ?? "",
            inline: field.inline ?? false,
        })),
    };
}

const REFUSALS: Record<string, string> = {
    discord_unknown_event: "adm_msgErrUnknownEvent",
    discord_bad_webhook: "adm_msgErrBadWebhook",
};

export default function DiscordMessagesPage() {
    const t = useTranslations("discordIntegration");
    const commonT = useTranslations("common");

    const [events, setEvents] = useState<KnownEvent[]>([]);
    const [openEvent, setOpenEvent] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft>(EMPTY);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState<"save" | "test" | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const res = await fetch("/api/v1/discord/events");
            if (!res.ok) throw new Error("read");
            const body = await res.json();
            const known: KnownEvent[] = body.events ?? [];
            setEvents(known);
            setOpenEvent((current) => current ?? known[0]?.event ?? null);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    // The boxes follow the event, so switching away does not carry one
    // event's wording into another's form.
    useEffect(() => {
        const found = events.find((event) => event.event === openEvent);
        if (found) setDraft(toDraft(found));
    }, [openEvent, events]);

    const current = events.find((event) => event.event === openEvent) ?? null;

    const embed = {
        title: draft.title || undefined,
        description: draft.description || undefined,
        footer: draft.footer ? { text: draft.footer } : undefined,
        fields: draft.fields,
    };
    const refusal = embedRefusal(embed);
    const unknown = current
        ? unknownPlaceholders(
            { title: draft.title, description: draft.description, footer: draft.footer, fields: draft.fields },
            current.placeholders,
        )
        : [];

    const used =
        draft.title.length + draft.description.length + draft.footer.length +
        draft.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);

    const save = async () => {
        if (!current) return;
        setBusy("save");
        try {
            const res = await fetch("/api/v1/discord/events", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    event: current.event,
                    isActive: draft.isActive,
                    webhookUrl: draft.webhookUrl.trim() || null,
                    title: draft.title.trim() || null,
                    description: draft.description.trim() || null,
                    footer: draft.footer.trim() || null,
                    fields: draft.fields.filter((field) => field.name.trim() !== "" || field.value.trim() !== ""),
                }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                const key = typeof body?.code === "string" ? REFUSALS[body.code] : undefined;
                if (body?.code === "discord_embed_too_long") {
                    toast.error(t("adm_msgErrTooLong", { over: body.over, by: body.by, limit: body.limit }));
                } else {
                    toast.error(key ? t(key) : t("adm_msgSaveFailed"));
                }
                return;
            }
            toast.success(t("adm_msgSaved"));
            await load();
        } catch {
            toast.error(t("adm_msgSaveFailed"));
        } finally {
            setBusy(null);
        }
    };

    const testSend = async () => {
        if (!current) return;
        setBusy("test");
        try {
            const res = await fetch("/api/v1/discord/test-send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ event: current.event }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                // The endpoint answers with the service's own words when the
                // service refused, which is the only useful thing there is.
                toast.error(body?.error ?? t("adm_msgTestFailed"));
                return;
            }
            toast.success(t("adm_msgTestSent"));
        } catch {
            toast.error(t("adm_msgTestFailed"));
        } finally {
            setBusy(null);
        }
    };

    if (loading) {
        return <Card><CardContent className="py-10 text-center text-muted-foreground">{commonT("loading")}</CardContent></Card>;
    }
    if (failed) {
        return (
            <>
                <AdminPageHeader title={t("adm_msgTitle")} description={t("adm_msgSubtitle")} />
                <Card><CardContent><LoadFailed onRetry={load} /></CardContent></Card>
            </>
        );
    }

    return (
        <>
            <AdminPageHeader
                title={t("adm_msgTitle")}
                description={t("adm_msgSubtitle")}
                backHref="/admin/discord"
                backLabel={commonT("back")}
                actions={
                    <div className="flex gap-2">
                        <Button variant="outline" disabled={busy !== null || !current} onClick={testSend}>
                            {busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
                            {t("adm_msgTest")}
                        </Button>
                        <Button disabled={busy !== null || !current} onClick={save}>
                            {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
                            {t("adm_msgSave")}
                        </Button>
                    </div>
                }
            />

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <Card className="lg:col-span-1">
                    <CardHeader><CardTitle>{t("adm_msgEvents")}</CardTitle></CardHeader>
                    <CardContent className="p-2">
                        <ul>
                            {events.map((event) => (
                                <li key={event.event}>
                                    <button
                                        type="button"
                                        onClick={() => setOpenEvent(event.event)}
                                        aria-current={event.event === openEvent}
                                        className={`w-full text-left px-3 py-2 rounded text-sm ${
                                            event.event === openEvent ? "bg-muted font-medium" : "hover:bg-muted/50"
                                        }`}
                                    >
                                        {t(event.labelKey)}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>

                <Card className="lg:col-span-3">
                    <CardHeader>
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <CardTitle>{current ? t(current.labelKey) : t("adm_msgTitle")}</CardTitle>
                            {/* Against the total across every box, which is the
                                limit an operator cannot find on their own. */}
                            <p className={`text-sm tabular-nums ${refusal ? "text-destructive" : "text-muted-foreground"}`}>
                                {t("adm_msgCount", { used, total: LIMITS.total })}
                            </p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {t("adm_msgPlaceholders", {
                                names: (current?.placeholders ?? []).map((name) => `{${name}}`).join(" "),
                            })}
                        </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {unknown.length > 0 && (
                            <p className="text-sm text-warning flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                                {t("adm_msgUnknownNames", { names: unknown.map((name) => `{${name}}`).join(" ") })}
                            </p>
                        )}
                        {refusal && (
                            <p className="text-sm text-destructive flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                                {t("adm_msgErrTooLong", { over: refusal.over, by: refusal.by, limit: refusal.limit })}
                            </p>
                        )}

                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                                checked={draft.isActive}
                                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                            />
                            {t("adm_msgActive")}
                        </label>

                        <div>
                            <Label htmlFor="msg-webhook">{t("adm_msgWebhook")}</Label>
                            <Input
                                id="msg-webhook"
                                value={draft.webhookUrl}
                                placeholder="https://discord.com/api/webhooks/..."
                                onChange={(e) => setDraft({ ...draft, webhookUrl: e.target.value })}
                            />
                            <p className="text-xs text-muted-foreground mt-1">{t("adm_msgWebhookHint")}</p>
                        </div>

                        <div>
                            <Label htmlFor="msg-title">{t("adm_msgEmbedTitle")}</Label>
                            <Input
                                id="msg-title"
                                value={draft.title}
                                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                            />
                        </div>

                        <div>
                            <Label htmlFor="msg-description">{t("adm_msgDescription")}</Label>
                            <Textarea
                                id="msg-description"
                                rows={4}
                                value={draft.description}
                                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                            />
                        </div>

                        <div>
                            <Label htmlFor="msg-footer">{t("adm_msgFooter")}</Label>
                            <Input
                                id="msg-footer"
                                value={draft.footer}
                                onChange={(e) => setDraft({ ...draft, footer: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <Label>{t("adm_msgFields")}</Label>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={draft.fields.length >= LIMITS.fields}
                                    onClick={() => setDraft({ ...draft, fields: [...draft.fields, { name: "", value: "", inline: false }] })}
                                >
                                    <Plus className="w-4 h-4" aria-hidden="true" />
                                    {t("adm_msgAddField")}
                                </Button>
                            </div>
                            {draft.fields.map((field, index) => (
                                <div key={index} className="flex items-center gap-2 flex-wrap">
                                    <Input
                                        value={field.name}
                                        aria-label={t("adm_msgFieldName")}
                                        placeholder={t("adm_msgFieldName")}
                                        className="flex-1 min-w-[8rem]"
                                        onChange={(e) => setDraft({ ...draft, fields: draft.fields.map((f, i) => (i === index ? { ...f, name: e.target.value } : f)) })}
                                    />
                                    <Input
                                        value={field.value}
                                        aria-label={t("adm_msgFieldValue")}
                                        placeholder={t("adm_msgFieldValue")}
                                        className="flex-1 min-w-[8rem]"
                                        onChange={(e) => setDraft({ ...draft, fields: draft.fields.map((f, i) => (i === index ? { ...f, value: e.target.value } : f)) })}
                                    />
                                    <label className="flex items-center gap-1 text-xs">
                                        <Checkbox
                                            checked={field.inline}
                                            aria-label={t("adm_msgInline")}
                                            onChange={(e) => setDraft({ ...draft, fields: draft.fields.map((f, i) => (i === index ? { ...f, inline: e.target.checked } : f)) })}
                                        />
                                        {t("adm_msgInline")}
                                    </label>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        aria-label={t("adm_msgRemoveField", { name: field.name })}
                                        onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })}
                                    >
                                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </>
    );
}
