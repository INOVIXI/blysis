"use client";

import { Footer, Navbar } from "@/core/sdk/layout";
import { usePathname } from "@/core/sdk/navigation";
import type { SiteShellProps } from "@/core/sdk/theme";
import Hero from "./Hero";
import { Cloud } from "./Sky";

/**
 * Kite's frame: a day that passes as the page scrolls. The morning sky with
 * its clouds stands behind the bar and the hero, the page warms towards the
 * evening as it goes down, and the footer is the night sky, opened by a row
 * of clouds. In the dark mode every one of those colours is the night's.
 *
 * The bar and the footer are core's, restyled in `theme.css` as Quarry's
 * are: the bar already folds the links that do not fit into a menu and
 * draws the phone menu, and a copy of it would have to keep up with both.
 */
export default function SiteShell({ children }: SiteShellProps) {
    const pathname = usePathname();
    return (
        <div className="kt-site min-h-screen flex flex-col">
            <div aria-hidden="true" className="kt-sky">
                <Cloud className="kt-sky-cloud" />
                <Cloud className="kt-sky-cloud" />
                <Cloud className="kt-sky-cloud" />
                <Cloud className="kt-sky-cloud" />
            </div>
            <div className="kt-bar">
                <Navbar />
            </div>
            {pathname === "/" ? <Hero /> : null}
            <main className="kt-main container mx-auto px-4 flex-1">{children}</main>
            <Footer />
        </div>
    );
}
