"use client";

import React from "react";
import { Navbar, Footer } from "@/core/components/layout";
import { ThemeComponentSlot } from "@/core/components/theme/ThemeComponentSlot";

export interface SiteShellProps {
    children: React.ReactNode;
}

function DefaultSiteShell({ children }: SiteShellProps) {
    return (
        <div className="min-h-screen flex flex-col bg-background">
            <ThemeComponentSlot name="Hero" />
            <Navbar />
            <main className="container mx-auto px-4 py-6 flex-1">{children}</main>
            <Footer />
        </div>
    );
}

/**
 * What every public page stands in: the hero, the navigation, the column the
 * page is drawn in and the footer.
 *
 * A theme could replace the navbar and the footer but not where they sit, so
 * a look with its navigation down the left edge had nowhere to start. A theme
 * that brings a `SiteShell` draws all of it, and is handed the page as
 * `children`. Client-side because the slot that chooses it reads the active
 * theme; what it is handed can still have been rendered on the server.
 */
export function SiteShell({ children }: SiteShellProps) {
    return <ThemeComponentSlot name="SiteShell" fallback={DefaultSiteShell}>{children}</ThemeComponentSlot>;
}
