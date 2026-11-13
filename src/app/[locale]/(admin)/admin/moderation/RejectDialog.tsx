"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/core/components/ui/button";
import { NativeSelect } from "@/core/components/ui/native-select";
import { Textarea } from "@/core/components/ui/textarea";
import { Label } from "@/core/components/ui/label";
import { ModalLayer } from "@/core/components/ui/modal-layer";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { useModalDialog } from "@/core/hooks/useModalDialog";

interface ReasonOption {
    id: string;
    displayLabel: string;
    enabled: boolean;
}

interface RejectDialogProps {
    /** How many items the rejection covers; null while the dialog is closed. */
    count: number | null;
    working: boolean;
    onCancel: () => void;
    onConfirm: (reasonId: string, note: string) => void;
}

/**
 * What a moderator rejects with: one of the site's reasons and, if they want,
 * a note only moderators read.
 *
 * It replaced a plain "are you sure", because a rejection that says nothing
 * leaves the author with nothing to learn from and the next moderator with
 * nothing to go on. The reasons are read each time it opens, so one the admin
 * just added or switched off is right without reloading the queue.
 */
export function RejectDialog({ count, working, onCancel, onConfirm }: RejectDialogProps) {
    const t = useTranslations("admin");
    const open = count !== null;
    const dialogRef = useModalDialog<HTMLDivElement>(open, onCancel);
    const reasonId = useId();
    const noteId = useId();
    const [reasons, setReasons] = useState<ReasonOption[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [chosen, setChosen] = useState("");
    const [note, setNote] = useState("");

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setReasons(null);
        setFailed(false);
        setNote("");
        fetch("/api/v1/admin/moderation/reasons")
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((data: { reasons?: ReasonOption[] }) => {
                if (cancelled) return;
                const offered = (data.reasons ?? []).filter((reason) => reason.enabled);
                setReasons(offered);
                setChosen(offered[0]?.id ?? "");
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [open, attempt]);

    if (!open) return null;
    const single = count === 1;

    return (
        <ModalLayer>
            <div className="fixed inset-0 z-[100] flex items-center justify-center" role="presentation">
                <div className="fixed inset-0 bg-black/50" onClick={onCancel} aria-hidden="true" />
                <div
                    ref={dialogRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="reject-title"
                    aria-describedby="reject-message"
                    className="relative bg-card border border-[var(--blysis-color-border)] rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto animate-fade-in"
                >
                    <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                            <AlertTriangle className="w-5 h-5 text-destructive" aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 id="reject-title" className="font-semibold text-foreground mb-1">
                                {single ? t("moderation_rejectSingleTitle") : t("moderation_rejectTitle", { count })}
                            </h2>
                            <p id="reject-message" className="text-sm text-muted-foreground">
                                {single ? t("moderation_rejectSingleMessage") : t("moderation_rejectMessage")}
                            </p>
                        </div>
                    </div>

                    <div className="mt-5 space-y-4">
                        {failed ? (
                            <LoadFailed onRetry={() => setAttempt((a) => a + 1)} />
                        ) : reasons === null ? (
                            <div className="flex justify-center py-4">
                                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
                            </div>
                        ) : reasons.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t("moderation_noReasons")}</p>
                        ) : (
                            <>
                                <div>
                                    <Label htmlFor={reasonId}>{t("moderation_rejectReason")}</Label>
                                    <NativeSelect
                                        id={reasonId}
                                        value={chosen}
                                        onChange={(e) => setChosen(e.target.value)}
                                    >
                                        {reasons.map((reason) => (
                                            <option key={reason.id} value={reason.id}>{reason.displayLabel}</option>
                                        ))}
                                    </NativeSelect>
                                </div>
                                <div>
                                    <Label htmlFor={noteId}>{t("moderation_rejectNote")}</Label>
                                    <Textarea
                                        id={noteId}
                                        rows={3}
                                        maxLength={500}
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        aria-describedby={`${noteId}-hint`}
                                    />
                                    <p id={`${noteId}-hint`} className="mt-1 text-xs text-muted-foreground">
                                        {t("moderation_rejectNoteHint")}
                                    </p>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 mt-6">
                        <Button variant="outline" size="sm" onClick={onCancel}>
                            {t("common_cancel")}
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={working || !chosen}
                            onClick={() => onConfirm(chosen, note.trim())}
                        >
                            {single ? t("moderation_rejectSingle") : t("moderation_rejectAll")}
                        </Button>
                    </div>
                </div>
            </div>
        </ModalLayer>
    );
}
