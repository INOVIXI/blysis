"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useRouter, usePathname } from "@/core/lib/i18n/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { PageFrame } from "@/core/components/layout/PageFrame";
import { ModuleProfileTabs } from "@/core/generated/module-registry";
import { ProfileTabRegistry } from "@/core/generated/module-components";
import { useAllModules } from "@/core/providers/module-provider";
import { ModuleErrorBoundary } from "@/core/components/ModuleErrorBoundary";
import { NotificationPrefsTab } from "@/core/components/profile/NotificationPrefsTab";
import { MessagesTab } from "@/core/components/profile/MessagesTab";
import { SessionsTab } from "@/core/components/profile/SessionsTab";
import { ActivityTab } from "@/core/components/profile/ActivityTab";
import { AccountNav, type AccountSection } from "@/core/components/profile/AccountNav";
import { AccountSettings } from "@/core/components/profile/AccountSettings";
import { PrivacyPanel } from "@/core/components/profile/PrivacyPanel";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { profileTabLabel } from "@/core/lib/profile-tab-label";

interface UserProfile {
    id: string;
    email: string;
    username: string;
    avatar: string | null;
    locale: string;
    currency: string;
    createdAt: string;
    role: {
        id: string;
        name: string;
        displayName: string;
        color: string | null;
        nameCss?: string | null;
        badgeCss?: string | null;
    } | null;
}

/** The section a member lands on, and the one an unknown name falls back to. */
const DEFAULT_SECTION = "profile";

/**
 * A member's own account.
 *
 * It drew its own page shell - its own `min-h-screen`, navbar, footer and a
 * `max-w-4xl` nobody else used - so it was visibly narrower than every page a
 * member reached it from, and the frame's crumb trail was missing. It also
 * kept the open section in `useState` behind a row of buttons that scrolled
 * sideways, which meant a section could not be linked to and the ones past
 * the right edge were only reachable by dragging.
 *
 * Now: the frame owns the measure, the sections are a column of links, and
 * `?section=` is the address. See `a-page-looks-like-the-page-next-to-it`,
 * which grew to cover core's own public pages the day this was found.
 */
export default function ProfilePage() {
    const { status: authStatus } = useSession();
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const modules = useAllModules();
    const t = useTranslations("profile");
    // No namespace: a module's label key names its own.
    const rootT = useTranslations();

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    // Only the tabs whose module is installed, enabled, and shipped a
    // component to draw.
    const moduleSections = ModuleProfileTabs
        .filter((tab) => isEnabledIn(modules, tab.module))
        .filter((tab) => ProfileTabRegistry[tab.id]);

    const sections: AccountSection[] = [
        { id: "profile", label: t("title") },
        { id: "activity", label: t("activity") },
        { id: "messages", label: t("messages") },
        { id: "notifications", label: t("notifications") },
        { id: "sessions", label: t("sessions") },
        // A module names its own section; the manifest's English `label` is
        // only the fallback.
        ...moduleSections.map((tab) => ({
            id: tab.id,
            label: profileTabLabel(tab, (key) => rootT.has(key), (key) => rootT(key)),
        })),
    ];

    const asked = params.get("section");
    // A name nobody offers opens the first section rather than an empty panel:
    // a stale link from a module that has since been uninstalled is a link
    // somebody still has.
    const active = sections.some((s) => s.id === asked) ? (asked as string) : DEFAULT_SECTION;
    const sectionHref = (id: string) => (id === DEFAULT_SECTION ? "/profile" : `/profile?section=${id}`);

    useEffect(() => {
        let cancelled = false;
        if (authStatus === "unauthenticated") {
            // Keep the section they were on: a session that expires while
            // somebody reads their own notification settings should not cost
            // them the trip back to that screen.
            const query = params.toString();
            const here = `${pathname || "/profile"}${query ? `?${query}` : ""}`;
            router.push(`/auth/login?callbackUrl=${encodeURIComponent(here)}`);
            return;
        }
        if (authStatus !== "authenticated") return;

        fetch("/api/v1/auth/profile")
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                if (data.user) setProfile(data.user);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [authStatus, router, pathname, params]);

    if (authStatus === "loading" || loading || !profile) {
        return (
            <PageFrame title={t("title")}>
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-label={t("loadingProfile")} />
                </div>
            </PageFrame>
        );
    }

    return (
        <PageFrame title={t("title")}>
            {/* The nav column is a fixed measure so the panel beside it keeps
                the same width from section to section; a column sized by its
                longest label moves the content every time a module adds one. */}
            <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] items-start">
                <AccountNav
                    sections={sections}
                    active={active}
                    href={sectionHref}
                    identity={{
                        username: profile.username,
                        email: profile.email,
                        avatar: profile.avatar,
                        role: profile.role,
                    }}
                />

                <div className="space-y-6 min-w-0">
                    {active === "profile" && (
                        <>
                            <AccountSettings
                                identity={profile}
                                onSaved={(next) => setProfile({ ...profile, ...next })}
                            />
                            <PrivacyPanel />
                        </>
                    )}
                    {active === "activity" && <ActivityTab />}
                    {active === "messages" && <MessagesTab />}
                    {active === "notifications" && <NotificationPrefsTab />}
                    {active === "sessions" && <SessionsTab />}
                    {moduleSections.map((tab) => {
                        if (active !== tab.id) return null;
                        const Section = ProfileTabRegistry[tab.id];
                        if (typeof Section !== "function") return null;
                        return (
                            <ModuleErrorBoundary key={tab.id}>
                                <Section />
                            </ModuleErrorBoundary>
                        );
                    })}
                </div>
            </div>
        </PageFrame>
    );
}
