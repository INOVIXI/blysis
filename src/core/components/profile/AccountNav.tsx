"use client";

import { MemberAvatar } from "@/core/components/ui/MemberAvatar";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { Link } from "@/core/lib/i18n/navigation";
import { RoleBadge } from "@/core/components/ui/RoleBadge";
import { RoleName } from "@/core/components/ui/RoleName";
import { useAllModules } from "@/core/providers/module-provider";
import { userProfilePath } from "@/core/lib/user-profile-link";
import type { ComponentProps } from "react";

type Role = ComponentProps<typeof RoleBadge>["role"];

export interface AccountSection {
    id: string;
    label: string;
}

/**
 * Who is signed in, and the parts of their account.
 *
 * This was a row of buttons above the content, scrolling sideways once there
 * were more sections than fitted - which on a site with a shop and a game
 * module is always. Sections past the edge were reachable only by dragging a
 * strip that also moved under the pointer, and the section a member was
 * reading was client state, so it could not be linked to, shared, or reached
 * with the back button.
 *
 * A column of links fixes both at once: every section is visible without
 * scrolling anything, and every section is an address.
 *
 * The card at the top is the way to the page everybody else sees. There was
 * no way to it from here at all: a member could edit their own profile and
 * had to guess the address to look at the result. It is a link only when a
 * module serves profiles - core has no page of its own to point at, and a
 * card that looks pressable and goes nowhere is worse than a card.
 */
export function AccountNav({
    sections,
    active,
    href,
    identity,
}: {
    sections: AccountSection[];
    active: string;
    /** Where a section lives, so the page owns its own address scheme. */
    href: (id: string) => string;
    identity: { username: string; email: string; avatar: string | null; role: Role };
}) {
    const t = useTranslations("profile");
    const modules = useAllModules();
    const publicProfile = userProfilePath(identity.username, modules);

    const card = (
        <>
            <div className="flex items-center gap-3">
                <MemberAvatar name={identity.username} src={identity.avatar} size={48} />
                <div className="min-w-0">
                    <div className="font-semibold text-foreground truncate">
                        <RoleName name={identity.username} role={identity.role} />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{identity.email}</p>
                </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
                <RoleBadge role={identity.role} />
                {publicProfile && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary">
                        {t("viewPublicProfile")}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </span>
                )}
            </div>
        </>
    );

    return (
        <div className="space-y-4">
            {publicProfile ? (
                <Link
                    href={publicProfile}
                    className="group block rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-muted/40"
                >
                    {card}
                </Link>
            ) : (
                <div className="rounded-xl border border-border bg-card p-4">{card}</div>
            )}

            <nav aria-label={t("title")}>
                <ul className="space-y-1">
                    {sections.map((section) => {
                        const current = section.id === active;
                        return (
                            <li key={section.id}>
                                <Link
                                    href={href(section.id)}
                                    aria-current={current ? "page" : undefined}
                                    // `scroll={false}`: a member switching sections is
                                    // already looking at the column they pressed, and
                                    // jumping to the top of the document to show them
                                    // the same heading again loses their place.
                                    scroll={false}
                                    className={`block rounded-lg px-3 py-2 text-sm transition-colors ${current
                                        ? "bg-primary/10 text-primary font-medium"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                        }`}
                                >
                                    {section.label}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>
        </div>
    );
}
