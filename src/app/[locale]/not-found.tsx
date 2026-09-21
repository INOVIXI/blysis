import { resolveLocaleFromRequest, notFoundStrings } from "@/core/lib/i18n/resolve-locale";
import { buttonClassName } from "@/core/components/ui/button";

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
 */
export default async function NotFound() {
    const locale = await resolveLocaleFromRequest();
    const t = await notFoundStrings(locale);

    return (
        <main className="flex flex-col items-center justify-center min-h-screen px-4">
            <div className="text-center max-w-md">
                <div className="text-[120px] font-black text-muted leading-none select-none mb-4" aria-hidden="true">
                    404
                </div>
                <h1 className="text-2xl font-bold text-foreground mb-2">{t.title}</h1>
                {t.description && <p className="text-muted-foreground mb-8">{t.description}</p>}
                <a
                    href={`/${locale}`}
                    className={buttonClassName()}
                >
                    {t.goHome}
                </a>
            </div>
        </main>
    );
}
