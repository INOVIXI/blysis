"use client";

import { Search } from "lucide-react";
import { Input, buttonClassName } from "@/core/sdk/ui";
import type { NotFoundProps } from "@/core/sdk/theme";
import { LostKite } from "./Sky";

/**
 * A missing page as a kite whose string broke: what happened and a search on
 * the left, and on the right the kite drifting off with the spool left
 * behind.
 *
 * The words are the ones core read, handed in, because the database may be
 * why the page is missing. Home is a plain anchor, as core's own is: the 404
 * is drawn when routing itself may be what failed.
 */
export default function NotFound({ title, description, goHome, homeHref, search, searchHref }: NotFoundProps) {
    return (
        <section className="kt-lost">
            <div className="kt-lost-words">
                <p aria-hidden="true" className="kt-lost-code">404</p>
                <h1 className="kt-lost-title">{title}</h1>
                {description ? <p className="kt-lost-lede">{description}</p> : null}
                <form role="search" action={searchHref} method="get" className="kt-lost-search">
                    <label className="sr-only" htmlFor="kt-lost-q">{search}</label>
                    <Input id="kt-lost-q" name="q" type="search" placeholder={search} />
                    <button type="submit" className={buttonClassName("outline")} aria-label={search}>
                        <Search className="w-4 h-4" aria-hidden="true" />
                    </button>
                </form>
                <a href={homeHref} className={`${buttonClassName("default", "lg")} kt-lost-home`}>{goHome}</a>
            </div>
            <div className="kt-lost-art">
                <LostKite className="kt-lost-kite" />
            </div>
        </section>
    );
}
