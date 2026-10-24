"use client";

import { PageBreadcrumb, type PageHeaderProps } from "@/core/sdk/theme";

/**
 * A page's name on a dark band across the whole width, closed by a strip of
 * the brand colour: the crumb trail, the page's only h1, what it is for and
 * the controls that act on all of it. The band is drawn by `theme.css` behind
 * the header, so it grows with what is written on it.
 */
export default function PageHeader({ title, description, trail, actions }: PageHeaderProps) {
    return (
        <header className="qr-page-header">
            <div className="qr-page-trail">
                <PageBreadcrumb trail={trail} current={title} />
            </div>
            <div className="qr-page-heading">
                <div className="min-w-0">
                    <h1 className="qr-page-title">{title}</h1>
                    {description ? <p className="qr-page-lede">{description}</p> : null}
                </div>
                {actions ? <div className="qr-page-actions">{actions}</div> : null}
            </div>
        </header>
    );
}
