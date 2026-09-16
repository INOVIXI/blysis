"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Megaphone, X } from "lucide-react";
import { isVisibleOnPage } from "../lib/visible-on";

interface Announcement {
    id: string;
    title: string;
    content: string;
    type?: string;
    dismissible?: boolean;
    /** Where the operator said this may appear. */
    includePages?: string | null;
    excludePages?: string | null;
}

/**
 * Full-width dismissible banner above the navbar showing the most
 * recent pinned announcement. Dismissal is persisted per-announcement
 * in localStorage.
 */
export default function AnnouncementTopBanner() {
    const t = useTranslations("announcements");
    const pathname = usePathname();
    const [announcement, setAnnouncement] = useState<Announcement | null>(null);

    useEffect(() => {
        let active = true;
        fetch("/api/v1/announcements")
            .then((r) => (r.ok ? r.json() : { announcements: [] }))
            .then((d: { announcements?: Announcement[] }) => {
                if (!active) return;
                // Endpoint already filters isActive + time bounds; take the
                // most recent one that the user hasn't yet dismissed.
                // The operator's own rule about where this may appear. It
                // was read by nothing, so a notice limited to the store was
                // drawn on every screen including the admin panel.
                const items = (d.announcements || []).filter((a) => isVisibleOnPage(a, pathname ?? "/"));
                if (typeof window === "undefined") {
                    if (items[0]) setAnnouncement(items[0]);
                    return;
                }
                const first = items.find((a) => !localStorage.getItem(`announcement-dismissed:${a.id}`));
                setAnnouncement(first ?? null);
            })
            .catch(() => undefined);
        return () => { active = false; };
    }, [pathname]);

    if (!announcement) return null;

    const dismiss = () => {
        if (typeof window !== "undefined") {
            localStorage.setItem(`announcement-dismissed:${announcement.id}`, "1");
        }
        setAnnouncement(null);
    };

    // The theme's own colours. These were fixed palette values with a
    // `dark:` counterpart, and this site switches modes on
    // [data-mode="dark"], not on Tailwind's variant: the dark half never
    // fired, so a dark banner kept its dark blue text on a dark background.
    const typeClasses: Record<string, string> = {
        info: "bg-primary/10 text-primary border-primary/20",
        warning: "bg-warning/10 text-warning border-warning/20",
        success: "bg-success/10 text-success border-success/20",
        error: "bg-destructive/10 text-destructive border-destructive/20",
    };

    const variant = typeClasses[announcement.type || "info"] || typeClasses.info;

    return (
        <div
            className={`w-full border-b ${variant}`}
            role="status"
            aria-live="polite"
        >
            <div className="container mx-auto px-4 py-2 flex items-center gap-3">
                <Megaphone className="w-4 h-4 flex-shrink-0" />
                {/*
                 * Clamped on the block that holds the text, not on the span
                 * inside it. `truncate` sat on that span, and on an inline box
                 * `overflow` and `text-overflow` do nothing at all - so the
                 * only half of it that applied was `white-space: nowrap`. The
                 * ellipsis never appeared, the line never broke, and on a
                 * 320px phone a 510px sentence made the whole document 554px
                 * wide. A mobile browser answers that by zooming the page out
                 * to fit, which is why the navigation drawer and the cookie
                 * notice were being drawn at 58% scale over a page that no
                 * longer matched the screen.
                 *
                 * Two lines on a phone rather than one: the title alone fills
                 * a 320px line, so clamping to one there would leave a notice
                 * whose message is never visible.
                 */}
                <div className="flex-1 min-w-0 text-sm line-clamp-2 sm:line-clamp-1">
                    <span className="font-semibold">{announcement.title}</span>
                    {announcement.content && (
                        <>
                            {" · "}
                            <span className="opacity-90">{announcement.content}</span>
                        </>
                    )}
                </div>
                <button
                    type="button"
                    onClick={dismiss}
                    className="flex-shrink-0 p-1 rounded hover:bg-foreground/10"
                    aria-label={t("dismiss")}
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}
