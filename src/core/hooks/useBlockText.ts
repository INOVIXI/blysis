"use client";

import { useMessages, useTranslations } from "next-intl";

/**
 * Words a block was given, in the reader's language.
 *
 * A theme writes its homepage in `theme.json`, so a heading it gives a block
 * there would be one language for every reader. A text setting may therefore
 * name a message: a value the site has a message under is shown translated,
 * and anything else, words an operator typed among them, is shown as written.
 * A name that leads to a group of messages rather than to one is not a
 * message, and is shown as written too.
 *
 * Example:
 *   const text = useBlockText();
 *   <h2>{text(settings.title)}</h2>
 */
export function useBlockText() {
    const t = useTranslations();
    const messages = useMessages();
    return (value: unknown): string => {
        if (typeof value !== "string") return "";
        let node: unknown = messages;
        for (const part of value.split(".")) {
            if (!node || typeof node !== "object" || !Object.prototype.hasOwnProperty.call(node, part)) return value;
            node = (node as Record<string, unknown>)[part];
        }
        return typeof node === "string" ? t(value) : value;
    };
}
