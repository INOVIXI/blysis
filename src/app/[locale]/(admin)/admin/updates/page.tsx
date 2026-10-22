"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, FlaskConical, Loader2, Lock, ShieldAlert, WifiOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { CheckboxField } from "@/core/components/ui/checkbox";
import { RadioField } from "@/core/components/ui/radio";
import { Badge } from "@/core/components/ui/badge";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { errorMessage, writeError } from "@/core/lib/write-result";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";

/**
 * What version this install runs, and the one button that changes it.
 *
 * The page polls while an update is in flight, because the process serving it
 * is the one being replaced: the answers stop for a while and then come back
 * from a different version. That is also why the progress it shows is read
 * from the updater's own log rather than from anything this page remembers.
 */

interface Release {
    version: string;
    tag: string;
    publishedAt: string;
    notes: string;
    security: boolean;
    stage: Stage;
}

type Stage = "stable" | "beta" | "rc";
type Channel = "stable" | "beta";

interface Intent {
    toVersion: string;
    fromVersion: string;
    state: "requested" | "running" | "done" | "failed";
    step: string;
    log: string[];
    finishedAt: string | null;
}

/** What a pre-release is called on its badge. A release has no badge. */
const STAGE_LABEL = {
    beta: "updates_stageBeta",
    rc: "updates_stageRc",
} as const;

const CHANNELS = [
    { id: "stable", label: "updates_channelStable", hint: "updates_channelStableHint" },
    { id: "beta", label: "updates_channelBeta", hint: "updates_channelBetaHint" },
] as const;

/**
 * The state words, written out rather than assembled.
 *
 * `t(`updates_state_${state}`)` reads fine and hides four keys from every tool
 * that looks for them - including the gate that says a string in the catalogue
 * is a string some screen says.
 */
const STATE_LABEL = {
    requested: "updates_state_requested",
    running: "updates_state_running",
    done: "updates_state_done",
    failed: "updates_state_failed",
} as const;

function stateLabel(state: string): string {
    return STATE_LABEL[state as keyof typeof STATE_LABEL] ?? STATE_LABEL.requested;
}

interface UpdateRow {
    id: string;
    fromVersion: string;
    toVersion: string;
    status: string;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
}

interface UpdateState {
    current: string;
    currentStage: Stage;
    channel: Channel;
    channelPinned: boolean;
    feedReadable: boolean;
    latest: Release | null;
    newest: Release | null;
    blockedBy: string | null;
    intent: Intent | null;
    canStart: boolean;
    history: UpdateRow[];
}

export default function UpdatesPage() {
    const t = useTranslations("admin");
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const { confirm } = useConfirm();
    const [state, setState] = useState<UpdateState | null>(null);
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(false);
    const [skipBackup, setSkipBackup] = useState(false);
    const [savingChannel, setSavingChannel] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/v1/admin/updates");
            if (!res.ok) return;
            setState(await res.json());
        } catch {
            // A failed poll during the swap is expected: the server is being
            // replaced. The next tick picks it up.
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const inFlight = state?.intent?.state === "requested" || state?.intent?.state === "running";

    useEffect(() => {
        if (!inFlight) return;
        const timer = setInterval(() => void load(), 5000);
        return () => clearInterval(timer);
    }, [inFlight, load]);

    const chooseChannel = async (channel: Channel) => {
        setSavingChannel(true);
        try {
            const res = await fetch("/api/v1/admin/updates", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channel }),
            });
            const failed = await writeError(res, t("updates_channelSaveFailed"), t);
            if (failed) {
                toast.error(failed);
                return;
            }
            toast.success(t("updates_channelSaved"));
            await load();
        } catch {
            toast.error(t("updates_channelSaveFailed"));
        } finally {
            setSavingChannel(false);
        }
    };

    const start = async (release: Release) => {
        const version = release.version;
        const ok = await confirm({
            title: t("updates_confirmTitle", { version }),
            // A pre-release says so before the button does anything, because
            // there is no stepping back down from one.
            message: release.stage === "stable" ? t("updates_confirmMessage") : t("updates_confirmPrerelease", { version }),
            variant: "danger",
        });
        if (!ok) return;

        setStarting(true);
        try {
            const res = await fetch("/api/v1/admin/updates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ version, skipBackup }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                toast.error(errorMessage(data, t("updates_startFailed"), t));
                return;
            }
            toast.success(t("updates_started"));
            void load();
        } catch {
            toast.error(t("updates_startFailed"));
        } finally {
            setStarting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!state) {
        return <p className="text-sm text-muted-foreground">{t("updates_loadFailed")}</p>;
    }

    const target = state.latest;
    // A site that left the beta channel while on a pre-release has nothing to
    // move to until that pre-release's own version ships, and an empty
    // "newest version" would be a lie about why.
    const waitingForRelease = state.channel === "stable" && state.currentStage !== "stable" && !target;

    return (
        <div className="space-y-6">
            <AdminPageHeader title={t("updates_title")} description={t("updates_description")} />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">{t("updates_installed", { version: state.current })}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!state.feedReadable && (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <WifiOff className="w-4 h-4" /> {t("updates_feedUnreadable")}
                        </p>
                    )}

                    {state.feedReadable && waitingForRelease && (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <FlaskConical className="w-4 h-4" /> {t("updates_waitingForRelease", { version: state.current.split("-")[0] })}
                        </p>
                    )}

                    {state.feedReadable && !target && !waitingForRelease && (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CheckCircle2 className="w-4 h-4" /> {t("updates_upToDate")}
                        </p>
                    )}

                    {target && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <span className="font-medium">{t("updates_available", { version: target.version })}</span>
                                {target.stage !== "stable" && (
                                    <Badge tone="warning" className="gap-1">
                                        <FlaskConical className="w-3 h-3" /> {t(STAGE_LABEL[target.stage])}
                                    </Badge>
                                )}
                                {target.security && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                                        <ShieldAlert className="w-3 h-3" /> {t("updates_security")}
                                    </span>
                                )}
                            </div>

                            {target.notes && (
                                <p className="whitespace-pre-line text-sm text-muted-foreground">{target.notes}</p>
                            )}

                            {state.blockedBy && state.newest && state.newest.version !== target.version && (
                                <p className="text-sm text-muted-foreground">
                                    {t("updates_stepFirst", { step: target.version, newest: state.newest.version })}
                                </p>
                            )}

                            <CheckboxField
                                checked={skipBackup}
                                onChange={(e) => setSkipBackup(e.target.checked)}
                                label={<span className="text-sm">{t("updates_skipBackup")}</span>}
                                description={t("updates_skipBackupHint")}
                            />

                            <div className="flex items-center gap-3">
                                <Button onClick={() => void start(target)} disabled={starting || inFlight || !state.canStart}>
                                    {(starting || inFlight) && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {t("updates_install", { version: target.version })}
                                </Button>
                                <span className="text-xs text-muted-foreground">{t("updates_downtime")}</span>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t("updates_channelTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div role="radiogroup" aria-label={t("updates_channelTitle")} className="space-y-3">
                        {CHANNELS.map((c) => (
                            <RadioField
                                key={c.id}
                                name="update-channel"
                                value={c.id}
                                checked={state.channel === c.id}
                                disabled={state.channelPinned || savingChannel || inFlight}
                                onChange={() => void chooseChannel(c.id)}
                                label={t(c.label)}
                                description={t(c.hint)}
                            />
                        ))}
                    </div>
                    {state.channelPinned && (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Lock className="w-4 h-4" /> {t("updates_channelPinned")}
                        </p>
                    )}
                </CardContent>
            </Card>

            {state.intent && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            {t("updates_progressTitle", { version: state.intent.toVersion })}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <p className="text-sm">{t(stateLabel(state.intent.state))}</p>
                        {state.intent.log.length > 0 && (
                            <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5 whitespace-pre-wrap">
                                {state.intent.log.join("\n")}
                            </pre>
                        )}
                    </CardContent>
                </Card>
            )}

            {state.history.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">{t("updates_history")}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-muted-foreground">
                                    <th className="px-4 py-2 font-medium">{t("updates_historyVersion")}</th>
                                    <th className="px-4 py-2 font-medium">{t("updates_historyStatus")}</th>
                                    <th className="px-4 py-2 font-medium">{t("updates_historyWhen")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.history.map((row) => (
                                    <tr key={row.id} className="border-b border-border last:border-0">
                                        <td className="px-4 py-2">{row.fromVersion} to {row.toVersion}</td>
                                        <td className="px-4 py-2">{t(stateLabel(row.status))}</td>
                                        <td className="px-4 py-2 text-muted-foreground">
                                            {formatDateTime(row.startedAt)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
