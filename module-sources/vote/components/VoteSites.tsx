"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, LoadFailed } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { Loader2, ExternalLink, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

interface VoteSite {
    id: string;
    name: string;
    url: string;
    icon: string | null;
    _count: { votes: number };
}

/**
 * The page used to have two buttons per site: "Vote Now", which opened the
 * listing, and "Claim Reward", which paid credits into the voter's balance.
 * There is no reward any more - the module points players at the listings the
 * server is ranked on and counts who went. So there is one button: it opens
 * the listing and records the vote in the same click, because asking someone
 * to come back and press a second button to be counted is how a vote count
 * ends up wrong.
 */

/**
 * The sites, drawn from what the server already read.
 *
 * The list used to be fetched on mount, so the HTML the server sent carried no
 * site and no reward. Recording a vote and opening the site is still this
 * component's job, and it is the only part that needs a browser.
 */
export function VoteSites({ initial }: { initial: VoteSite[] }) {
    const { data: session } = useSession();
    const t = useTranslations("vote");
    const [sites] = useState<VoteSite[]>(initial);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [loading] = useState(false);
    const [voting, setVoting] = useState<string | null>(null);


    const vote = async (site: VoteSite) => {
        // The listing opens either way: a signed-out visitor, a site already
        // voted on today, a failed write - none of them is a reason to keep
        // someone from voting.
        window.open(site.url, "_blank", "noopener,noreferrer");
        if (!session?.user) return;
        setVoting(site.id);
        try {
            const res = await fetch("/api/v1/vote/record", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ voteSiteId: site.id }),
            });
            if (res.ok) {
                toast.success(t("voteRecorded"));
            } else {
                // The endpoint answers in English; what it carries for the
                // reader is the `code`. The cooldown one comes with the hours
                // left so the sentence can be built in their own language.
                const data = await res.json().catch(() => null);
                if (data?.code === "vote_cooldown") {
                    toast.error(t("cooldownHours", { hours: Number(data?.hours ?? 24) }));
                } else if (data?.code === "vote_in_flight") {
                    toast.error(t("voteInFlight"));
                } else {
                    toast.error(t("voteFailed"));
                }
            }
        } catch {
            toast.error(t("voteFailed"));
        } finally {
            setVoting(null);
        }
    };

    return (
        <PageFrame
            title={t("title")}
            description={t("description")}
        >
            {!session?.user && (
                <p className="mb-6 text-sm text-muted-foreground">{t("loginToVote")}</p>
            )}

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : failed ? (
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            ) : sites.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("noSites")}</CardContent></Card>
            ) : (
                <div className="space-y-3">
                    {sites.map((site) => (
                        <Card key={site.id} className="hover:shadow-md transition-shadow">
                            <CardContent className="p-4 flex items-center gap-4">
                                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <ThumbsUp className="w-6 h-6 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h2 className="font-medium truncate">{site.name}</h2>
                                    {/*
                                        Clicks, not votes, and the label says
                                        so. Nothing here hears back from the
                                        listing: the button opens it and the
                                        row is written because somebody went,
                                        not because they voted. Calling this a
                                        vote count put a number on the screen
                                        the site cannot know. The key is
                                        already lower case - lowercasing it
                                        here would be the Turkish I bug
                                        waiting to happen.
                                    */}
                                    <p className="text-sm text-muted-foreground">
                                        {site._count.votes} {t("totalVotes")}
                                    </p>
                                </div>
                                <Button size="sm" onClick={() => vote(site)} disabled={voting === site.id}>
                                    {voting === site.id
                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                        : <ExternalLink className="w-3 h-3" />}
                                    {t("voteNow")}
                                </Button>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </PageFrame>
    );
}
