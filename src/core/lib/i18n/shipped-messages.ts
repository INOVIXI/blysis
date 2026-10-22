/**
 * The catalogue this version ships, as opposed to the one in the table.
 *
 * The table is the source of truth for anything an operator edited and for
 * every module, and a seeder copies these files into it on each boot. Between
 * a release and that seeder is a window where a string exists in the code and
 * not in the table, and every screen using one renders the key: the update
 * screen shipped reading `admin.updates_title` to anybody who opened it.
 *
 * Reading the file closes that window, and it answers a second question the
 * translation editor asks - what did this string say before anybody touched
 * it? That answer is what an edit is judged against and what reverting one
 * puts back.
 */

import fs from "node:fs";
import path from "node:path";
import { isUnsafeKey } from "@/core/lib/safe-object";
import { locales } from "@/core/lib/i18n/config";

const shipped = new Map<string, Record<string, Record<string, unknown>>>();

export function shippedMessages(locale: string): Record<string, Record<string, unknown>> {
    // The locale becomes part of a path, so it is held to the served list
    // here rather than trusted to every caller to have done it first.
    // `tests/unit/a-shipped-catalogue-is-read-only-for-a-served-locale.test.ts`.
    if (!(locales as readonly string[]).includes(locale)) return {};

    const cached = shipped.get(locale);
    if (cached) return cached;

    let parsed: Record<string, Record<string, unknown>> = {};
    try {
        const file = path.join(process.cwd(), "messages-core", `${locale}.json`);
        parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Record<string, unknown>>;
    } catch {
        // A locale core ships no catalogue for is a module's business, and an
        // unreadable file is not a reason to serve no strings at all.
        parsed = {};
    }
    shipped.set(locale, parsed);
    return parsed;
}

/**
 * One string out of one namespace, by its dotted key.
 *
 * A catalogue entry may be nested or flat, and both forms are accepted on the
 * way in, so both have to be accepted on the way out. The whole key is tried
 * first: an entry written flat names exactly what was asked for, which makes
 * it the more specific of the two answers.
 */
export function messageAt(namespace: Record<string, unknown>, key: string): string | null {
    const parts = key.split(".");
    if (parts.some(isUnsafeKey)) return null;

    const flat = Object.prototype.hasOwnProperty.call(namespace, key) ? namespace[key] : undefined;
    if (typeof flat === "string") return flat;

    let here: unknown = namespace;
    for (const part of parts) {
        if (typeof here !== "object" || here === null) return null;
        if (!Object.prototype.hasOwnProperty.call(here, part)) return null;
        here = (here as Record<string, unknown>)[part];
    }
    return typeof here === "string" ? here : null;
}
