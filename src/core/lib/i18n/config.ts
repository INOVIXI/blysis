// i18n Configuration
export const locales = ['en', 'tr', 'az', 'de', 'es', 'et', 'fr', 'it', 'pl', 'pt', 'ru', 'zh'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/**
 * Each language named in itself, since that is how a reader looking for
 * theirs will recognise it. `pt` is Brazilian Portuguese and `zh` is
 * Simplified Chinese: the route segment stays two letters because the proxy
 * and every module route match `/[a-z]{2}/`.
 */
export const localeNames: Record<Locale, string> = {
    en: 'English',
    tr: 'Türkçe',
    az: 'Azərbaycanca',
    de: 'Deutsch',
    es: 'Español',
    et: 'Eesti',
    fr: 'Français',
    it: 'Italiano',
    pl: 'Polski',
    pt: 'Português (Brasil)',
    ru: 'Русский',
    zh: '简体中文',
};
