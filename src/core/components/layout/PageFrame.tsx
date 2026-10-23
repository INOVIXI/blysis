import React from "react";
import SidebarLayout from "@/core/components/layout/SidebarLayout";
import { SiteShell } from "@/core/components/layout/SiteShell";
import { PageHeader } from "@/core/components/layout/PageHeader";
import type { Crumb } from "@/core/components/layout/PageBreadcrumb";

export interface PageFrameProps {
    /** Names the page. Drawn as the only h1 and closing the crumb trail. */
    title: string;
    description?: React.ReactNode;
    /** The steps between the home page and this one. */
    trail?: Crumb[];
    /** Controls that act on the whole page, drawn beside its title. */
    actions?: React.ReactNode;
    /** Widgets for the right column. Omitted, the content spans the page. */
    sidebar?: React.ReactNode;
    children: React.ReactNode;
}

/**
 * The shell every public page is drawn in.
 *
 * Each module used to write this by hand, and 31 hand-written shells drifted
 * the way hand-written things do: nine content widths between max-w-2xl and
 * the full container, a breadcrumb on nine pages of the 31, two page
 * backgrounds, and a couple of titles wearing an icon. Moving from Blog to
 * Trophies moved the left edge of the text, which reads as a different site
 * rather than a different page.
 *
 * Owning the measure here is what makes "one width" outlive the next module:
 * a page cannot set its own, because it never writes the element that would
 * carry it. The header sits above both columns for the same reason it is here
 * at all - a sidebar that starts level with the breadcrumb puts every widget
 * card a heading's height above the content it sits beside.
 *
 * Deliberately not "use client": rendered from a server page it stays on the
 * server, and rendered from a page that says "use client" it compiles with it.
 * Both kinds of page exist and both need the same frame. The shell and the
 * header it draws through are the two parts a theme may redraw.
 */
export function PageFrame({ title, description, trail, actions, sidebar, children }: PageFrameProps) {
    return (
        <SiteShell>
            <PageHeader title={title} description={description} trail={trail} actions={actions} />
            {sidebar ? <SidebarLayout sidebar={sidebar}>{children}</SidebarLayout> : children}
        </SiteShell>
    );
}
