import { Link } from "@/core/lib/i18n/navigation";
import {
    Activity,
    AlertTriangle,
    Bell,
    BookOpen,
    ClipboardList,
    Coins,
    Download,
    FileText,
    Gift,
    GitBranch,
    Lightbulb,
    Megaphone,
    MessageSquare,
    ShoppingBag,
    ThumbsUp,
    Ticket,
    UserCog,
    UserPlus,
} from "lucide-react";
import { Card, CardContent } from "@/core/components/ui/card";
import { useLocale, useTranslations } from "next-intl";
import { localizeActivityTitle } from "@/core/lib/activity-title";
import { userProfilePath } from "@/core/lib/user-profile-link";
import { formatRelativeTime } from "@/core/lib/utils";

type IconComponent = React.ComponentType<{ className?: string }>;

const ICON_MAP: Record<string, IconComponent> = {
    FileText,
    ShoppingBag,
    MessageSquare,
    Ticket,
    Lightbulb,
    GitBranch,
    Megaphone,
    BookOpen,
    ClipboardList,
    Download,
    ThumbsUp,
    Gift,
    Coins,
    UserPlus,
    AlertTriangle,
    Bell,
    UserCog,
    Activity,
};

export function getActivityIcon(name: string | null | undefined): IconComponent {
    if (!name) return Activity;
    return ICON_MAP[name] || Activity;
}

export interface ActivityItem {
    id: string;
    type: string;
    title: string;
    body: string | null;
    href: string | null;
    icon: string | null;
    isPublic: boolean;
    createdAt: string | Date;
    actor: { id: string; username: string; avatar: string | null } | null;
}

/**
 * `moduleStates` decides whether an actor's name links to their profile. It
 * arrives as a prop rather than from `useAllModules` because two of the three
 * callers are server components, where a context read is not available.
 */
export function ActivityFeedList({ items, moduleStates, emptyMessage }: {
    items: ActivityItem[];
    moduleStates: Record<string, boolean>;
    emptyMessage?: string;
}) {
    const activityT = useTranslations("activity");
    const profileT = useTranslations("profile");
    const locale = useLocale();
    if (items.length === 0) {
        return (
            <Card>
                <CardContent className="py-12 text-center text-muted-foreground text-sm">
                    {emptyMessage ?? profileT("noRecentActivity")}
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-2">
            {items.map((item) => {
                const Icon = getActivityIcon(item.icon);
                const when = formatRelativeTime(item.createdAt, locale);
                const profilePath = userProfilePath(item.actor?.username, moduleStates);
                return (
                    <Card key={item.id} className="hover:border-primary/50 transition-colors">
                        <CardContent className="p-3 flex items-start gap-3">
                            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                <Icon className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline justify-between gap-2">
                                    {item.href ? (
                                        <Link href={item.href} className="text-sm text-foreground hover:text-primary truncate">
                                            {localizeActivityTitle(item.type, item.title, activityT)}
                                        </Link>
                                    ) : (
                                        <span className="text-sm text-foreground truncate">{localizeActivityTitle(item.type, item.title, activityT)}</span>
                                    )}
                                    <span className="text-[10px] text-muted-foreground flex-shrink-0 whitespace-nowrap">{when}</span>
                                </div>
                                {item.actor && (
                                    <div className="text-xs text-muted-foreground mt-0.5">
                                        {profilePath ? (
                                            <Link href={profilePath} className="hover:text-primary">
                                                {item.actor.username}
                                            </Link>
                                        ) : (
                                            <span>{item.actor.username}</span>
                                        )}
                                    </div>
                                )}
                                {item.body && (
                                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.body}</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
