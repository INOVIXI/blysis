"use client";

import { PageBreadcrumb, type PageHeaderProps } from "@/core/sdk/theme";

/**
 * A page's name on a dark band across the whole width, closed by a strip of
 * the brand colour: the crumb trail, the page's only h1, what it is for and
 * the controls that act on all of it. The band is drawn by `theme.css` behind
 * the header, so it grows with what is written on it.
 *
 * A page that offers a picture, an article's cover, gets it behind the band,
 * which then stands taller with the title low over the dark end of it: a
 * magazine's opening spread. A line a page offers about itself, the
 * article's section, date and author, stands under the title either way.
 */
export default function PageHeader({ title, description, trail, actions, picture, meta }: PageHeaderProps) {
    return (
        <header className="qr-page-header" data-picture={picture ? "" : undefined}>
            {picture ? (
                <div aria-hidden="true" className="qr-page-picture" style={{ backgroundImage: `url(${JSON.stringify(picture)})` }} />
            ) : null}
            <div className="qr-page-trail">
                <PageBreadcrumb trail={trail} current={title} />
            </div>
            <div className="qr-page-heading">
                <div className="min-w-0">
                    <h1 className="qr-page-title">{title}</h1>
                    {description ? <p className="qr-page-lede">{description}</p> : null}
                    {meta ? <div className="qr-page-meta">{meta}</div> : null}
                </div>
                {actions ? <div className="qr-page-actions">{actions}</div> : null}
            </div>
        </header>
    );
}
