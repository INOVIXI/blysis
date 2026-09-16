import React from "react";
import { Navbar, Footer } from "@/core/components/layout";
import { ThemeComponentSlot } from "@/core/components/theme/ThemeComponentSlot";
import SidebarLayout from "@/core/components/layout/SidebarLayout";
import { PageBreadcrumb, type Crumb } from "@/core/components/layout/PageBreadcrumb";

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
 * Both kinds of page exist and both need the same frame.
 */
export function PageFrame({ title, description, trail, actions, sidebar, children }: PageFrameProps) {
    return (
        <div className="min-h-screen flex flex-col bg-background">
            <ThemeComponentSlot name="Hero" />
            <Navbar />

            <main className="container mx-auto px-4 py-6 flex-1">
                <header className="mb-6">
                    <PageBreadcrumb trail={trail} current={title} />
                    <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            {/* `font-extrabold`, not `font-bold`: the page's
                                name is the heaviest thing on it, and at 700 it
                                sat level with the section headings inside the
                                article below it. */}
                            <h1 className="text-3xl font-extrabold text-foreground">{title}</h1>
                            {description ? (
                                <p className="text-muted-foreground mt-1">{description}</p>
                            ) : null}
                        </div>
                        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
                    </div>
                </header>

                {sidebar ? <SidebarLayout sidebar={sidebar}>{children}</SidebarLayout> : children}
            </main>

            <Footer />
        </div>
    );
}
