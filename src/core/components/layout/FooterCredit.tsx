"use client";

import { useTranslations } from "next-intl";
import { CREDIT_URL } from "@/core/config/credit";
import { cn } from "@/core/lib/utils";

/**
 * What every site runs on, at the foot of every footer, whichever theme draws
 * it. One sentence, one key: three keys glued together read as "Built with
 * by Blysis" in English and came out in the wrong order in Turkish, where
 * the verb is last.
 *
 * The whole sentence is the link. With only the name linked, a site named
 * like the product drew two links called "Blysis", its own name home and
 * this one away, which `a-control-says-which-one-it-is.spec.ts` refuses.
 */
export function FooterCredit({ className }: { className?: string }) {
    const t = useTranslations("footer");
    // The product's name from the catalogue, so a build under another name
    // credits itself; see core-does-not-put-its-own-name-on-a-page.test.ts.
    const common = useTranslations("common");
    return (
        <p className={cn("text-sm text-muted-foreground", className)}>
            {t.rich("poweredBy", {
                name: common("appName"),
                link: (chunks) => (
                    <a
                        href={CREDIT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary font-medium hover:underline underline-offset-4 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                        {chunks}
                    </a>
                ),
            })}
        </p>
    );
}
