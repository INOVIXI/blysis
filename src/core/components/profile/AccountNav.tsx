"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/core/lib/i18n/navigation";
import { RoleBadge } from "@/core/components/ui/RoleBadge";
import { RoleName } from "@/core/components/ui/RoleName";
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

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 shrink-0 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-lg font-bold overflow-hidden">
                        {identity.avatar ? (
                            <Image src={identity.avatar} alt="" width={48} height={48} className="w-full h-full object-cover" unoptimized />
                        ) : (
                            (identity.username || "U")[0].toUpperCase()
                        )}
                    </div>
                    <div className="min-w-0">
                        <div className="font-semibold text-foreground truncate">
                            <RoleName name={identity.username} role={identity.role} />
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{identity.email}</p>
                    </div>
                </div>
                <RoleBadge role={identity.role} className="mt-3" />
            </div>

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
