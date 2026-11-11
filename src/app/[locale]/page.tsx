import { getTranslations } from "next-intl/server";
import { Link } from "@/core/lib/i18n/navigation";
import { SiteShell } from "@/core/components/layout/SiteShell";
import { PageLayoutView } from "@/core/components/layout/PageLayoutView";
import { loadHomeLayout } from "@/core/lib/page-layout-loader";
import { readSettingValues } from "@/core/lib/setting-values";
import { textFor } from "@/core/lib/i18n/translatable-text";
import { HomeWelcome } from "./HomeWelcome";

export const dynamic = "force-dynamic";

/**
 * The homepage is its arrangement: which blocks, in which rows, is decided
 * once by `resolveLayout` from what the operator saved, what the active
 * theme ships and the widget settings sites had before either existed.
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    const commonT = await getTranslations("common");
    const [layout, settings] = await Promise.all([
        loadHomeLayout(),
        readSettingValues(["site_name"]).catch(() => ({}) as Record<string, unknown>),
    ]);
    // The name as the reader's language has it, since the operator may write
    // it per language.
    const siteName = textFor(settings.site_name, locale).trim();

    return (
        <SiteShell>
            {/*
                The homepage is a stack of module blocks, none of which is the
                page's own title, so it had no h1 at all: a screen reader landed
                on the page with nothing naming it, and the document outline
                started at h2. The name is not drawn since the design has no
                room for it, but it is announced and it is what a crawler reads
                first.
            */}
            <h1 className="sr-only">{siteName || commonT("home")}</h1>

            {/* `data-home-trail` is how a theme reaches this line, to hide it
                where its homepage opens on a hero instead. */}
            <div data-home-trail className="text-sm text-muted-foreground mb-4">
                <Link href="/" className="hover:text-primary transition-colors">{commonT("home")}</Link>
            </div>

            <PageLayoutView layout={layout} welcome={<HomeWelcome />} />
        </SiteShell>
    );
}
