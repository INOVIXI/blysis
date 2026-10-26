"use client";

import type { CSSProperties } from "react";
import { Footer, Navbar } from "@/core/sdk/layout";
import { usePathname } from "@/core/sdk/navigation";
import type { SiteShellProps } from "@/core/sdk/theme";
import Hero from "./Hero";
import heroPicture from "@/themes/quarry/pictures/hero.jpg";

/**
 * Quarry's frame: the site's own bar across the top, the homepage's hero
 * under it from edge to edge, the page in the column below and the footer.
 *
 * The bar is core's, restyled in `theme.css`: it already folds the links that
 * do not fit into a menu and draws the phone menu, and a copy of it would
 * have to keep up with both.
 *
 * The theme's own picture is handed to the stylesheet as `--qr-cover`, for a
 * band that wants a landscape behind it and has none of its own: a member's
 * profile, which carries no cover picture.
 */
export default function SiteShell({ children }: SiteShellProps) {
    const pathname = usePathname();
    return (
        <div
            className="qr-site min-h-screen flex flex-col bg-background"
            style={{ "--qr-cover": `url(${JSON.stringify(heroPicture.src)})` } as CSSProperties}
        >
            <div className="qr-bar">
                <Navbar />
            </div>
            {pathname === "/" ? <Hero /> : null}
            <main className="qr-main container mx-auto px-4 flex-1">{children}</main>
            <Footer />
        </div>
    );
}
