import { getRequestConfig } from 'next-intl/server';
import { locales, defaultLocale, type Locale } from './config';
import { getMessages } from './translation-service';
import { siteTimeZone } from '../site-time-setting';

/**
 * The zone is declared here so both sides of a render agree on what day it is.
 *
 * Without it next-intl leaves `toLocaleDateString` to the ambient zone: the
 * host's on the server, the visitor's in the browser. A date near midnight then
 * renders as two different days and React throws the subtree away and draws it
 * again. Declaring it once puts the operator's zone in the request config,
 * which the client provider carries, so a client component can name the same
 * zone on its first render without fetching anything.
 */

export default getRequestConfig(async ({ requestLocale }) => {
    let locale = await requestLocale;

    if (!locale || !locales.includes(locale as Locale)) {
        locale = defaultLocale;
    }

    return {
        locale,
        messages: await getMessages(locale),
        timeZone: await siteTimeZone(),
    };
});
