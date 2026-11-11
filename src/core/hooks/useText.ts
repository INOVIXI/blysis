"use client";

import { useLocale } from "next-intl";
import { textFor } from "@/core/lib/i18n/translatable-text";

/**
 * Text the operator wrote, in the reader's language: their translation where
 * there is one, otherwise the original.
 *
 * The locale is the page's own, which the server rendered with, so the word
 * the browser settles on is the word the server sent.
 */
export function useText(): (value: unknown) => string {
    const locale = useLocale();
    return (value: unknown) => textFor(value, locale);
}
