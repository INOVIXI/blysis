"use client";

import { Link, usePathname } from "@/core/sdk/navigation";
import { Slot } from "@/core/sdk/layout";
import { useThemeConfig } from "@/core/sdk/theme";
import { ArrowRight } from "lucide-react";

/**
 * Flat theme hero - centered headline, subtitle, single CTA.
 *
 * Off by default. Admins enable it under Theme → Hero and supply copy.
 * When disabled (or no title set) the component renders nothing, so the
 * theme stays clean for sites that don't want a hero.
 *
 * It is the homepage's, as its setting says. Every page frame places the
 * Hero slot, and drawn on all of them it stood above each page's own title.
 * Its heading is an h2 for the same reason: the homepage names itself in an
 * h1 already, and a page has one.
 *
 * `hero.bottom` is drawn under the banner, in the banner's measure, which
 * is where modules that declare it expect to be: nothing else on the page
 * places that slot, and a contribution brings no margins of its own.
 */

/**
 * Laid over a background photo so the words on it can be read: the brand
 * colour the words are drawn against everywhere else, in light mode and dark.
 */
const VEIL = "color-mix(in srgb, var(--blysis-color-primary) 75%, transparent)";

export default function Hero() {
    const get = useThemeConfig();
    const pathname = usePathname();
    const enabled = get<boolean>("hero.enabled", false);
    if (!enabled || pathname !== "/") return null;

    const title = get<string>("hero.title", "") ?? "";
    const subtitle = get<string>("hero.subtitle", "") ?? "";
    const ctaText = get<string>("hero.ctaText", "") ?? "";
    const ctaHref = get<string>("hero.ctaHref", "") ?? "";
    const bgImage = get<string>("hero.backgroundImage", "") ?? "";

    if (!title && !subtitle && !ctaText) return null;

    const style: React.CSSProperties = bgImage
        ? {
              backgroundImage: `linear-gradient(${VEIL}, ${VEIL}), url(${bgImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              color: "var(--blysis-color-primaryForeground)",
          }
        : {
              background:
                  "linear-gradient(135deg, var(--blysis-color-primary) 0%, var(--blysis-color-accent) 100%)",
              color: "var(--blysis-color-primaryForeground)",
          };

    return (
        <>
            <section className="w-full" style={style}>
                <div className="max-w-5xl mx-auto px-4 py-16 md:py-24 text-center">
                    {title ? (
                        <h2 className="text-3xl md:text-5xl font-bold tracking-tight drop-shadow-sm">
                            {title}
                        </h2>
                    ) : null}
                    {subtitle ? (
                        <p className="mt-4 text-base md:text-lg opacity-90 max-w-2xl mx-auto">
                            {subtitle}
                        </p>
                    ) : null}
                    {ctaText && ctaHref ? (
                        <div className="mt-8">
                            <Link
                                href={ctaHref}
                                className="inline-flex items-center gap-2 rounded-md bg-primary-foreground text-primary px-6 py-2.5 font-medium shadow-sm hover:bg-primary-foreground/90 transition-colors"
                            >
                                {ctaText}
                                <ArrowRight className="w-4 h-4" />
                            </Link>
                        </div>
                    ) : null}
                </div>
            </section>
            <div className="max-w-5xl mx-auto px-4 py-3 empty:hidden">
                <Slot name="hero.bottom" />
            </div>
        </>
    );
}
