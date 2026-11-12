"use client";

import { useTranslations } from "next-intl";
import { Badge, Card, CardContent, useLocalDateTime } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import type { MemberStatus } from "../lib/member-status";

/**
 * What a member sent, as they read it: when, where it stands, and the note
 * the team left them. Shared by the form's own page and the profile tab, so
 * the two never disagree about how a decision is told.
 */

export interface MySubmission {
    id: string;
    status: MemberStatus;
    reviewNote: string | null;
    createdAt: string;
    /** Present on the profile tab, where the list spans every form. */
    form?: { title: string; slug: string; isActive: boolean };
}

interface MySubmissionsProps {
    submissions: MySubmission[];
}

const TONE: Record<MemberStatus, "info" | "neutral" | "success" | "danger"> = {
    pending: "info",
    handled: "neutral",
    approved: "success",
    rejected: "danger",
};

export function MySubmissions({ submissions }: MySubmissionsProps) {
    const t = useTranslations("customForms");
    const formatDateTime = useLocalDateTime();

    return (
        <Card>
            <CardContent className="p-4">
                <h2 className="mb-3 font-medium text-foreground">{t("yourSubmissions")}</h2>
                <ul className="space-y-3">
                    {submissions.map((sub) => (
                        <li key={sub.id} className="border-b border-border/50 pb-3 last:border-0 last:pb-0">
                            <div className="flex flex-wrap items-center gap-3">
                                {sub.form && (
                                    sub.form.isActive
                                        ? <Link href={`/form/${sub.form.slug}`} className="font-medium text-foreground hover:underline">{sub.form.title}</Link>
                                        : <span className="font-medium text-foreground">{sub.form.title}</span>
                                )}
                                <Badge tone={TONE[sub.status]}>{t(`status_${sub.status}`)}</Badge>
                                <span className="text-xs text-muted-foreground">
                                    {t("sentOn", { date: formatDateTime(sub.createdAt) })}
                                </span>
                            </div>
                            {sub.reviewNote && (
                                <div className="mt-2 rounded-md bg-muted p-3 text-sm">
                                    <p className="mb-1 text-xs font-medium text-muted-foreground">{t("noteFromTeam")}</p>
                                    <p className="whitespace-pre-wrap text-foreground">{sub.reviewNote}</p>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
