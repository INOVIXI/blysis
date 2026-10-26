"use client";

import { Search } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Input, buttonClassName } from "@/core/sdk/ui";
import { useNavLinks, type NotFoundProps } from "@/core/sdk/theme";

/** How many of the site's own links the post carries, home included. */
const SIGNS = 4;

/**
 * A missing page as a wrong turn: what happened on the left, and on the
 * right a signpost whose boards are home and the first of the site's own
 * links, alternating left and right, with a search under the words.
 *
 * The words are the ones core read, handed in, because the database may be
 * why the page is missing; the boards are the bar's links, which fall back
 * to the modules' own when the site's arrangement cannot be read.
 */
export default function NotFound({ title, description, goHome, homeHref, search, searchHref }: NotFoundProps) {
    const { links } = useNavLinks();
    const boards = [
        { href: homeHref, label: goHome, external: true },
        ...links
            .flatMap((link) => (link.children && link.children.length > 0 ? link.children : [link]))
            .filter((link) => link.href !== "/")
            .map((link) => ({ href: link.href, label: link.label, external: false })),
    ].slice(0, SIGNS);

    return (
        <section className="qr-lost">
            <div className="qr-lost-words">
                <p aria-hidden="true" className="qr-lost-code">404</p>
                <h1 className="qr-lost-title">{title}</h1>
                {description ? <p className="qr-lost-lede">{description}</p> : null}
                <form role="search" action={searchHref} method="get" className="qr-lost-search">
                    <label className="sr-only" htmlFor="qr-lost-q">{search}</label>
                    <Input id="qr-lost-q" name="q" type="search" placeholder={search} />
                    <button type="submit" className={buttonClassName("default")} aria-label={search}>
                        <Search className="w-4 h-4" aria-hidden="true" />
                    </button>
                </form>
            </div>
            <nav className="qr-lost-post" aria-label={goHome}>
                <span aria-hidden="true" className="qr-lost-pole" />
                {boards.map((board, n) => (
                    // Home is a plain anchor, as core's own is: the 404 is
                    // drawn when routing itself may be what failed.
                    board.external ? (
                        <a key={board.href} href={board.href} className="qr-lost-board" data-side={n % 2 ? "left" : "right"}>{board.label}</a>
                    ) : (
                        <Link key={board.href} href={board.href} className="qr-lost-board" data-side={n % 2 ? "left" : "right"}>{board.label}</Link>
                    )
                ))}
            </nav>
        </section>
    );
}
