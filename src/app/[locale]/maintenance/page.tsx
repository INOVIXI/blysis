import { Link } from "@/core/lib/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { Wrench, LogIn } from "lucide-react";
import { getMaintenanceConfig } from "@/core/lib/maintenance";
import { coreScreenMetadata } from "@/core/lib/core-screens";
import { textFor } from "@/core/lib/i18n/translatable-text";

export const dynamic = "force-dynamic";

// A server component, so it names itself directly - no sibling layout needed.
export const generateMetadata = coreScreenMetadata("/maintenance");

export default async function MaintenancePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const config = await getMaintenanceConfig();
    const t = await getTranslations("maintenance");
    const commonT = await getTranslations("common");
    // The operator's own message wins, in the reader's language where they
    // wrote one; the fallback is the one core writes.
    const message = textFor(config.message, locale).trim() || t("defaultMessage");

    return (
        <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-warning/15 text-warning mb-6">
                    <Wrench className="w-8 h-8" />
                </div>
                <h1 className="text-3xl font-bold text-foreground mb-3">
                    {t("title")}
                </h1>
                <p className="text-muted-foreground text-base leading-relaxed mb-8 whitespace-pre-line">
                    {message}
                </p>
                <div className="pt-2">
                    <Link
                        href="/auth/login"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-sm font-medium"
                    >
                        <LogIn className="w-4 h-4" aria-hidden="true" />
                        {commonT("login")}
                    </Link>
                </div>
            </div>
        </div>
    );
}
