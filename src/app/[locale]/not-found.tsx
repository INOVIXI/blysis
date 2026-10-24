import { resolveLocaleFromRequest, notFoundStrings } from "@/core/lib/i18n/resolve-locale";
import { SiteShell } from "@/core/components/layout/SiteShell";
import { NotFoundContent } from "@/core/components/layout/NotFoundContent";

/**
 * The 404 for a `notFound()` thrown anywhere under a locale.
 *
 * It renders content only. Next composes a `not-found` with the layouts above
 * it, so `app/[locale]/layout.tsx` supplies the document: this file used to
 * carry its own `<html>` and `<body>` on the belief that a root layout on a
 * top-level dynamic segment leaves a not-found page with nothing to compose
 * out of. What that produced was a document inside a document. React failed
 * the boundary on the server and streamed an empty `__next_error__` shell
 * instead - the right 404 status, but no heading and no text, so a crawler, a
 * text browser and a reader with scripting off all got a blank page. The
 * markup was in the flight payload, visible only once JavaScript ran.
 *
 * It reads its strings through `notFoundStrings` rather than `useTranslations`
 * so that a 404 still renders when the database is the reason for it, and asks
 * for the locale by cookie and header rather than by a segment it cannot see.
 *
 * It stands in the site's shell, bar and footer included: a reader who
 * followed a stale link lands on the site, with somewhere to go from it,
 * rather than on a bare card. A theme draws the content as `NotFound`.
 */
export default async function NotFound() {
    const locale = await resolveLocaleFromRequest();
    const t = await notFoundStrings(locale);

    return (
        <SiteShell>
            <NotFoundContent
                title={t.title}
                description={t.description}
                goHome={t.goHome}
                homeHref={`/${locale}`}
                search={t.search}
                searchHref={`/${locale}/search`}
            />
        </SiteShell>
    );
}
