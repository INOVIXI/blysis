
import React from "react";

interface SidebarLayoutProps {
    children: React.ReactNode;
    sidebar: React.ReactNode;
    /**
     * A section heading over the content column. Given one, the layout also
     * offsets the sidebar by exactly its height, so both columns still start
     * their first card on the same line.
     */
    heading?: React.ReactNode;
}

/**
 * Two-column page shell: content on the left, widgets on the right.
 *
 * The sidebar is allowed to render nothing. Widgets decide for themselves
 * whether they have anything to show (a "recent purchases" widget returns
 * null on a store with no orders), so a caller that passes a non-empty list
 * of widgets can still end up with an empty column. Reserving a third of the
 * page for it leaves the content visibly pushed to the left on a fresh
 * install. The `data-sidebar` / `data-sidebar-main` hooks let globals.css
 * collapse the column instead, and bring it back the moment a widget has
 * something to render.
 *
 * A section in the content column is a heading and then its cards; a widget
 * is a card with its heading inside. Left alone the two columns start at the
 * same y, which puts every widget a heading's height above the cards beside
 * it - the thing that reads as crooked, reported three times. So the heading
 * is passed in rather than written above the layout: one component draws it
 * and the spacer that answers it, and the two cannot drift apart.
 * `a-column-starts-where-the-one-beside-it-does.spec.ts` measures the result.
 *
 * On a phone the one column is stated as `grid-cols-1`, a `minmax(0, 1fr)`
 * track. Left implicit it is an `auto` track, which grows to the widest
 * min-content of anything in it: a widget's tab rail that scrolls on its own
 * still pushed the column, every card beside it and the document to 600px on
 * a 320px phone. `a-page-fits-the-phone-it-is-read-on.spec.ts` measures it.
 */
export default function StandardSidebarLayout({ children, sidebar, heading }: SidebarLayoutProps) {
    return (
        <div data-sidebar-layout className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div data-sidebar-main className="lg:col-span-2">
                {heading ? (
                    <h2 className="text-xl font-bold text-foreground mb-6">{heading}</h2>
                ) : null}
                {children}
            </div>
            <div data-sidebar className="space-y-5">
                {heading ? (
                    <div aria-hidden="true" className="hidden lg:block blysis-heading-spacer" />
                ) : null}
                {sidebar}
            </div>
        </div>
    );
}
