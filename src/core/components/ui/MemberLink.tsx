"use client";

import * as React from "react";
import { Link } from "@/core/lib/i18n/navigation";
import { MemberAvatar } from "@/core/components/ui/MemberAvatar";
import { useAllModules } from "@/core/providers/module-provider";
import { userProfilePath } from "@/core/lib/user-profile-link";
import { cn } from "@/core/lib/utils";

/**
 * A member, wherever one is named beside their face.
 *
 * `MemberAvatar` settled what a face looks like. What sat around it was still
 * written per screen: four homepage widgets each drew their own rounded square
 * with `username[0].toUpperCase()` in it, the blog's comments drew a name with
 * no face at all, and none of the five was a link - the whole right-hand
 * column of the home page listed the site's best customers and there was no
 * way to reach any of them.
 *
 * So: the face, the name, and the way to the person. A link only where a
 * module serves profiles, because core has no page of its own to point at and
 * a name that looks pressable and goes nowhere is worse than a name.
 *
 * A client component: which modules are enabled comes from context. A server
 * component that needs the same thing passes `moduleStates` to whatever it is
 * already rendering, the way `ActivityFeedList` does.
 */

export interface MemberLinkProps {
    username: string;
    avatar?: string | null;
    /** Pixels for the face. The name follows the surrounding text size. */
    size?: number;
    /** A quieter second line: what they bought, when they joined. */
    subtitle?: React.ReactNode;
    className?: string;
    nameClassName?: string;
    /** Draw the name only. For a row that already shows the face elsewhere. */
    hideAvatar?: boolean;
}

export function MemberLink({
    username,
    avatar,
    size = 32,
    subtitle,
    className,
    nameClassName,
    hideAvatar = false,
}: MemberLinkProps) {
    const modules = useAllModules();
    const href = userProfilePath(username, modules);

    const body = (
        <>
            {!hideAvatar && <MemberAvatar name={username} src={avatar} size={size} />}
            <span className="min-w-0">
                <span className={cn("block truncate font-medium text-foreground", href && "group-hover:text-primary", nameClassName)}>
                    {username}
                </span>
                {subtitle !== undefined && subtitle !== null && (
                    <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
                )}
            </span>
        </>
    );

    const shared = cn("flex min-w-0 items-center gap-3", className);
    if (!href) return <span className={shared}>{body}</span>;

    return (
        <Link href={href} className={cn("group transition-colors", shared)}>
            {body}
        </Link>
    );
}
