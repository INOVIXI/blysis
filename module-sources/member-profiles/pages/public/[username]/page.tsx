import { getTranslations } from "next-intl/server";
import { Link } from "@/core/sdk/navigation";
import { Card, CardContent, CardHeader, CardTitle, MemberAvatar, RoleBadge } from "@/core/sdk/ui";
import { PageFrame, Slot } from "@/core/sdk/layout";
import { ArrangedPage } from "@/core/sdk/server";
import { MessageSquare, FileText, ShoppingCart, ThumbsUp, Calendar } from "lucide-react";
import { isListable } from "../../../lib/member-content";
import { readMember } from "../../../lib/read-member";
import { JoinedOn } from "../../../components/JoinedOn";

interface PageProps {
    params: Promise<{ username: string }>;
}

/** The name as typed in the address, or as given when it is not valid escaping. */
function decodedName(raw: string): string {
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

/**
 * A member's profile, written by the server.
 *
 * It fetched itself after the page had loaded, so not a word of a profile
 * was in the HTML the server sent. It reads the member through `readMember`
 * now, the function the endpoint calls too.
 *
 * The page is built from the blocks `module.json` declares for the `profile`
 * page: the band that says who this is and what they have done, the tabs to
 * what they have written, the accounts they proved, their newest topics and
 * whatever other modules put under a profile. A theme arranges them; with no
 * word from the theme the page stands as it always has.
 */
export default async function MemberProfilePage({ params }: PageProps) {
    const { username } = await params;
    const t = await getTranslations("memberProfiles");
    const member = await readMember(decodedName(username));

    if (!member) {
        return (
            <PageFrame title={username}>
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("memberNotFound")}</CardContent></Card>
            </PageFrame>
        );
    }

    // A counter that can be opened is a link. The five of them were plain
    // text: a reader saw "42 posts" and that was the end of the trip. Orders
    // stay text on purpose - they are counted here and a stranger reading
    // somebody else's shopping is not a feature - and `isListable` is what
    // says which is which.
    const stats = [
        { key: "orders", label: t("stat_orders"), value: member._count.orders, icon: ShoppingCart },
        { key: "topics", label: t("stat_topics"), value: member._count.topics, icon: MessageSquare },
        { key: "posts", label: t("stat_posts"), value: member._count.posts, icon: FileText },
        { key: "comments", label: t("stat_comments"), value: member._count.comments, icon: FileText },
        { key: "suggestions", label: t("stat_suggestions"), value: member._count.suggestions, icon: ThumbsUp },
    ].filter((s): s is typeof s & { value: number } => s.value !== undefined);
    const opens = (key: string, value: number) => isListable(key) && value > 0;
    const contentHref = (key: string) => `/u/${member.username}/content?kind=${key}`;

    // The member's own picture, then whatever a linked account brought with
    // it. This used to build a URL at a third party's head-render service out
    // of a linked Minecraft name, which is a service this module has no
    // business knowing about and a game this site may have nothing to do
    // with. `LinkedAccount.avatar` is where a picture that came with an
    // identity belongs. With neither, `MemberAvatar` draws the initials on the
    // colour their name picks - the same face they have in every list.
    const avatar = member.avatar || member.linkedAccounts.find((a) => a.avatar)?.avatar || null;

    return (
        <ArrangedPage
            page="member-profiles.profile"
            frame={{ title: member.username }}
            blocks={{
                band: ({ settings }) => (
                    <div data-profile-band>
                        <div className="flex items-center gap-5 mb-8">
                            <MemberAvatar name={member.username} src={avatar} size={80} className="shadow-sm" />
                            <div>
                                {/* Drawn only where the theme hid the header
                                    band; the page's h1 still names the
                                    member, so this is not read twice. */}
                                {settings.name === true ? (
                                    <p data-profile-name aria-hidden="true" className="text-3xl font-extrabold text-foreground">{member.username}</p>
                                ) : null}
                                <RoleBadge role={member.role ?? null} className="mt-1" />
                                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {t("joinDate")}: <JoinedOn date={member.createdAt} />
                                </p>
                            </div>
                        </div>
                        <div data-profile-stats className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            {stats.map((s) => {
                                const body = (
                                    <CardContent className="p-3 text-center">
                                        <s.icon className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
                                        <p className="text-xl font-bold">{s.value}</p>
                                        <p className="text-xs text-muted-foreground">{s.label}</p>
                                    </CardContent>
                                );
                                // Nothing written is nothing to open.
                                if (!opens(s.key, s.value)) return <Card key={s.key}>{body}</Card>;
                                return (
                                    <Link key={s.key} href={contentHref(s.key)} className="group block">
                                        <Card className="h-full transition-colors group-hover:border-primary/40">{body}</Card>
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                ),
                tabs: () => {
                    const listable = stats.filter((s) => opens(s.key, s.value));
                    if (listable.length === 0) return null;
                    return (
                        <nav aria-label={t("profileSections")} data-profile-tabs className="flex flex-wrap gap-6 border-b border-border">
                            <span aria-current="page" className="py-3 text-sm font-medium text-foreground border-b-2 border-primary">{t("overview")}</span>
                            {listable.map((s) => (
                                <Link key={s.key} href={contentHref(s.key)} className="py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
                                    {s.label}
                                </Link>
                            ))}
                        </nav>
                    );
                },
                accounts: () => (member.linkedAccounts.length > 0 ? (
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
                ) : null),
                activity: () => (member.recentTopics.length > 0 ? (
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
                ) : null),
                // Whatever else a module has to say about this member. The
                // wall of profile posts arrives here; so does anything a site
                // adds later.
                more: () => <Slot name="memberProfile.below" context={{ userId: member.id, username: member.username }} />,
            }}
        />
    );
}
