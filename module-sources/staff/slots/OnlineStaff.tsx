"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface StaffMember {
    id: string;
    name: string;
    role: string;
    user?: { username: string; avatar: string | null } | null;
}

/** How many are named before the rest are counted. */
const SHOWN = 5;

/**
 * Slot contribution rendered below the hero banner: who on the team is online
 * right now, each with the role they hold.
 *
 * Fetches from the staff module's own public endpoint with ?online=1, which
 * cross-references StaffMember rows with active UserSessions. It draws the
 * strip and nothing around it: where `hero.bottom` sits, and how far from the
 * banner, is the theme's to decide.
 */
export default function OnlineStaff() {
    const t = useTranslations("staff");
    const [members, setMembers] = useState<StaffMember[]>([]);

    useEffect(() => {
        let active = true;
        fetch("/api/v1/staff?online=1")
            .then((r) => (r.ok ? r.json() : { members: [] }))
            .then((d: { members?: StaffMember[] }) => {
                if (active) setMembers(d.members || []);
            })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    if (members.length === 0) return null;

    const label = t("onlineNow");
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider opacity-80">{label}</span>
            <ul aria-label={label} className="flex flex-wrap items-center gap-2">
                {members.slice(0, SHOWN).map((m) => {
                    const name = m.user?.username || m.name;
                    const avatar = m.user?.avatar;
                    return (
                        <li key={m.id} className="flex items-center gap-2 rounded-md bg-foreground/10 py-1 pl-1 pr-2.5">
                            <span className="w-6 h-6 rounded overflow-hidden bg-muted text-muted-foreground flex items-center justify-center text-xs font-semibold" aria-hidden="true">
                                {avatar ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={avatar} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    name.slice(0, 1).toUpperCase()
                                )}
                            </span>
                            <span className="text-sm font-semibold">{name}</span>
                            <span className="text-xs opacity-75">{m.role}</span>
                        </li>
                    );
                })}
                {members.length > SHOWN && (
                    <li className="text-xs font-semibold opacity-75">+{members.length - SHOWN}</li>
                )}
            </ul>
        </div>
    );
}
