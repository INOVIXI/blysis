"use client";

import { ThemeComponentSlot } from "@/core/components/theme/ThemeComponentSlot";
import { buttonClassName } from "@/core/components/ui/button";

/** The words a missing page says and where it sends the reader, read by core. */
export interface NotFoundProps {
    title: string;
    description: string;
    goHome: string;
    homeHref: string;
    /** The label of a search over the whole site. */
    search: string;
    searchHref: string;
}

function DefaultNotFound({ title, description, goHome, homeHref }: NotFoundProps) {
    return (
        <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="text-center max-w-md">
                <div className="text-[120px] font-black text-muted leading-none select-none mb-4" aria-hidden="true">
                    404
                </div>
                <h1 className="text-2xl font-bold text-foreground mb-2">{title}</h1>
                {description && <p className="text-muted-foreground mb-8">{description}</p>}
                {/* A plain anchor: the 404 is drawn when routing itself may
                    be what failed. */}
                <a href={homeHref} className={buttonClassName()}>
                    {goHome}
                </a>
            </div>
        </div>
    );
}

/**
 * What a missing page says, inside the site's frame. A theme that brings a
 * `NotFound` draws it its own way, from the words core already read: they
 * are handed in rather than looked up, because the database may be the
 * reason the page is missing.
 */
export function NotFoundContent(props: NotFoundProps) {
    return <ThemeComponentSlot name="NotFound" fallback={DefaultNotFound} {...props} />;
}
