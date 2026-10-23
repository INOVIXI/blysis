"use client";

import React from "react";
import { ThemeComponentSlot } from "@/core/components/theme/ThemeComponentSlot";
import { PageBreadcrumb, type Crumb } from "@/core/components/layout/PageBreadcrumb";

export interface PageHeaderProps {
    title: string;
    description?: React.ReactNode;
    trail?: Crumb[];
    actions?: React.ReactNode;
}

function DefaultPageHeader({ title, description, trail, actions }: PageHeaderProps) {
    return (
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
    );
}

/**
 * The band that names a page: its crumb trail, its only h1, what it is for
 * and the controls that act on all of it.
 *
 * A theme that brings a `PageHeader` draws the band its own way, a backdrop
 * behind the title for one, and is handed the same four things core draws
 * from. The page itself never writes this element, which is what keeps one
 * page's title where the next page's is.
 */
export function PageHeader(props: PageHeaderProps) {
    return <ThemeComponentSlot name="PageHeader" fallback={DefaultPageHeader} {...props} />;
}
