"use client";

import { PageBreadcrumb, type PageHeaderProps } from "@/core/sdk/theme";
import { KiteMark } from "./Sky";

/**
 * A page's name on the morning sky: the crumb trail, the label the theme's
 * arrangement may give it, the page's only h1, what it is for and the
 * controls that act on all of it, with a kite on its string to the right.
 *
 * A page that offers a picture, an article's cover, is drawn as a postcard
 * instead: the picture in a white frame with a stamp in its corner, and the
 * title, the line the page says about itself and its controls written under
 * it, as on the back of a card that came in the post.
 */
export default function PageHeader({ title, description, trail, actions, picture, meta, kicker, pageName }: PageHeaderProps) {
    const words = (
        <div className="kt-page-heading">
            <div className="kt-page-words">
                {meta ? <div className="kt-page-meta">{meta}</div> : null}
                {kicker ? <p className="kt-page-kicker" data-kicker="">{kicker}</p> : null}
                <h1 className="kt-page-title">{title}</h1>
                {description ? <p className="kt-page-lede">{description}</p> : null}
            </div>
            {actions ? <div className="kt-page-actions">{actions}</div> : null}
        </div>
    );

    return (
        <header className="kt-page-header" data-picture={picture ? "" : undefined}>
            <div className="kt-page-trail">
                <PageBreadcrumb trail={trail} current={pageName ?? title} />
            </div>
            {picture ? (
                <div className="kt-postcard">
                    <div aria-hidden="true" className="kt-postcard-picture" style={{ backgroundImage: `url(${JSON.stringify(picture)})` }} />
                    <span aria-hidden="true" className="kt-stamp"><KiteMark className="kt-stamp-kite" /></span>
                    {words}
                </div>
            ) : (
                <>
                    {words}
                    <KiteMark className="kt-page-kite" />
                </>
            )}
        </header>
    );
}
