"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { LoadFailed, Waiting, useBlockText, type BlockProps } from "@/core/sdk/ui";

interface StaffMember {
    id: string;
    name: string;
    role: string;
    avatar: string | null;
    user?: { username: string; avatar: string | null } | null;
}

/** How many are listed; a homepage card is not the team page. */
const SHOWN = 6;

/**
 * `staff.online`: who on the team is online right now, as a card a theme
 * places, where the `hero.bottom` strip says it in a line. Online means a
 * live session on this website; which game server a member is playing on is
 * not something the site knows.
 *
 * It stays on the page when nobody is on: in a row of three cards, one that
 * drew nothing would leave a hole.
 */
export function OnlineCard({ settings }: BlockProps) {
    const t = useTranslations("staff");
    const commonT = useTranslations("common");
    const text = useBlockText();
    const [members, setMembers] = useState<StaffMember[] | null>(null);
    // A read that did not come back is not an empty team
    // (an-empty-screen-says-which-empty).
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let active = true;
        fetch("/api/v1/staff?online=1")
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d: { members?: StaffMember[] }) => { if (active) setMembers(d.members ?? []); })
            .catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [reloadKey]);

    const retry = () => {
        setFailed(false);
        setMembers(null);
        setReloadKey((k) => k + 1);
    };

    return (
        <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
                <Users className="w-4 h-4 text-primary" aria-hidden="true" />
                <h2 className="font-bold text-foreground">{text(settings.title) || t("onlineNow")}</h2>
            </div>
            {failed ? (
                <LoadFailed onRetry={retry} className="py-6" />
            ) : members === null ? (
                <Waiting label={commonT("loading")} />
            ) : members.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("blk_nobodyOnline")}</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {members.slice(0, SHOWN).map((m) => {
                        const name = m.user?.username || m.name;
                        const avatar = m.avatar || m.user?.avatar;
                        return (
                            <li key={m.id} data-staff-member className="flex items-center gap-3 rounded-md bg-muted/50 px-2.5 py-2">
                                <span className="w-8 h-8 shrink-0 rounded overflow-hidden bg-primary/15 text-primary flex items-center justify-center text-sm font-bold" aria-hidden="true">
                                    {avatar ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={avatar} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        name.slice(0, 1).toUpperCase()
                                    )}
                                </span>
                                <span className="min-w-0">
                                    <span className="block truncate font-semibold text-foreground">{name}</span>
                                    <span data-staff-role className="block truncate text-xs font-semibold text-muted-foreground">{m.role}</span>
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
