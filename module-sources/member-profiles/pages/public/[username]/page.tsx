"use client";

import { useState, useEffect, use } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/core/sdk/navigation";
import { Card, CardContent, CardHeader, CardTitle, MemberAvatar, RoleBadge, useLocalDate } from "@/core/sdk/ui";

import { PageFrame, Slot } from "@/core/sdk/layout";
import { Loader2, MessageSquare, FileText, ShoppingCart, ThumbsUp, Calendar } from "lucide-react";
import { isListable } from "../../../lib/member-content";

interface Member {
    id: string;
    username: string;
    avatar: string | null;
    createdAt: string;
    role: {
        id: string;
        name: string;
        displayName: string;
        color: string | null;
        nameCss?: string | null;
        badgeCss?: string | null;
    } | null;
    // Only the statistics this install can actually count. A module that is
    // not installed contributes no key at all, so nothing renders a zero for it.
    _count: Record<string, number | undefined>;
    recentTopics: { id: string; title: string; slug: string; createdAt: string }[];
    linkedAccounts: { provider: string; username: string | null; avatar: string | null }[];
}

interface PageProps {
    params: Promise<{ username: string }>;
}

export default function MemberProfilePage({ params }: PageProps) {
    const __locale = useLocale();
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const { username } = use(params);
    const t = useTranslations("memberProfiles");
    const [member, setMember] = useState<Member | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/v1/members/${username}`)
            .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
            .then((d) => {
                if (cancelled) return;
                setMember(d.member);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [username]);

    return (
        <PageFrame
            title={member?.username ?? username}
        >
            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : !member ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("memberNotFound")}</CardContent></Card>
            ) : (
                <>
                    {/* Profile Header */}
                    <div className="flex items-center gap-5 mb-8">
                        {/* The member's own picture, then whatever a linked
                            account brought with it. This used to build a URL at
                            a third party's head-render service out of a linked
                            Minecraft name, which is a service this module has
                            no business knowing about and a game this site may
                            have nothing to do with. `LinkedAccount.avatar` is
                            where a picture that came with an identity belongs.

                            With neither, `MemberAvatar` draws the initials on
                            the colour their name picks - the same face they
                            have in every list on the site, rather than a
                            gradient square this page drew for itself. */}
                        <MemberAvatar
                            name={member.username}
                            src={member.avatar || member.linkedAccounts.find((a) => a.avatar)?.avatar || null}
                            size={80}
                            className="shadow-sm"
                        />
                        <div>
                            <RoleBadge role={member.role ?? null} className="mt-1" />
                            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {t("joinDate")}: {formatDate(member.createdAt)}
                            </p>
                        </div>
                    </div>

                    {/* Stats.

                        A counter that can be opened is a link. The five of
                        them were plain text: a reader saw "42 posts" and that
                        was the end of the trip. Orders stay text on purpose -
                        they are counted here and a stranger reading somebody
                        else's shopping is not a feature - and `isListable`
                        is what says which is which. */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                        {[
                            { key: "orders", label: t("stat_orders"), value: member._count.orders, icon: ShoppingCart },
                            { key: "topics", label: t("stat_topics"), value: member._count.topics, icon: MessageSquare },
                            { key: "posts", label: t("stat_posts"), value: member._count.posts, icon: FileText },
                            { key: "comments", label: t("stat_comments"), value: member._count.comments, icon: FileText },
                            { key: "suggestions", label: t("stat_suggestions"), value: member._count.suggestions, icon: ThumbsUp },
                        ].filter((s): s is typeof s & { value: number } => s.value !== undefined).map((s) => {
                            const body = (
                                <CardContent className="p-3 text-center">
                                    <s.icon className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
                                    <p className="text-xl font-bold">{s.value}</p>
                                    <p className="text-xs text-muted-foreground">{s.label}</p>
                                </CardContent>
                            );
                            // Nothing written is nothing to open.
                            if (!isListable(s.key) || s.value === 0) {
                                return <Card key={s.key}>{body}</Card>;
                            }
                            return (
                                <Link key={s.key} href={`/u/${member.username}/content?kind=${s.key}`} className="group block">
                                    <Card className="h-full transition-colors group-hover:border-primary/40">{body}</Card>
                                </Link>
                            );
                        })}
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                        {/* Linked Accounts */}
                        {member.linkedAccounts.length > 0 && (
                            <Card>
                                <CardHeader><CardTitle className="text-sm">{t("linkedAccounts")}</CardTitle></CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        {member.linkedAccounts.map((acc) => (
                                            <div key={acc.provider} className="flex items-center gap-2 text-sm">
                                                <span className="capitalize font-medium text-foreground">{acc.provider}</span>
                                                {acc.username && <span className="text-muted-foreground">{acc.username}</span>}
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* Recent Topics */}
                        {member.recentTopics.length > 0 && (
                            <Card>
                                <CardHeader><CardTitle className="text-sm">{t("activity")}</CardTitle></CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        {member.recentTopics.map((topic) => (
                                            <Link key={topic.id} href={`/forum/topic/${topic.id}/${topic.slug}`} className="block text-sm text-foreground hover:text-primary transition-colors truncate">
                                                {topic.title}
                                            </Link>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </div>

                    {/* Whatever else a module has to say about this member.
                        The wall of profile posts arrives here; so does
                        anything a site adds later. */}
                    <Slot
                        name="memberProfile.below"
                        context={{ userId: member.id, username: member.username }}
                    />
                </>
            )}
        </PageFrame>
    );
}
