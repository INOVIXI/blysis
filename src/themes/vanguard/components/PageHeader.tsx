"use client";

import { PageBreadcrumb, type PageHeaderProps } from "@/core/sdk/theme";
import { Stage } from "./Stage";

/**
 * A page's name on the stage: the crumb trail, the page's only h1, what it is
 * for and the controls that act on all of it, on the same backdrop the
 * homepage opens on. The stage grows with what is written on it.
 */
export default function PageHeader({ title, description, trail, actions }: PageHeaderProps) {
    return (
        <header className="vg-page-header">
            <Stage />
            <div className="vg-page-trail">
                <PageBreadcrumb trail={trail} current={title} />
            </div>
            <div className="vg-page-heading">
                <div className="min-w-0">
                    <h1 className="vg-page-title">{title}</h1>
                    {description ? <p className="vg-page-lede">{description}</p> : null}
                </div>
                {actions ? <div className="vg-page-actions">{actions}</div> : null}
            </div>
        </header>
    );
}
