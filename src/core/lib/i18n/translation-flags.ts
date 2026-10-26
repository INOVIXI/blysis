/**
 * What a change to a string asks of its other languages.
 *
 * An operator who rewords the Turkish leaves the English saying what the
 * Turkish used to, and nothing on the screen said so. A change now marks
 * every other language that says the string as awaiting translation; one
 * that puts a language back to what ships marks only the languages the site
 * reworded, since a shipped translation of a shipped original still matches.
 * Saving a language clears whatever was asked of it. The seeder asks for the
 * other kind, a review, when an update moves an original under an edit.
 * `a-string-asks-to-be-looked-at-again` holds both.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/lib/db";
import { FLAG_TRANSLATE } from "./flag-reasons";
import type { Line, LineRef } from "./translation-lines";

/** A language whose words a change replaced, and whether with what ships. */
export interface FlagChange {
    locale: string;
    toShipped: boolean;
}

/** The writes beside a change: `written` looked at, the others asked to follow `changes`. */
export function flagCalls(ref: LineRef, line: Line, written: string[], changes: FlagChange[]) {
    const calls: Prisma.PrismaPromise<unknown>[] = [
        prisma.translationFlag.deleteMany({
            where: { namespace: ref.namespace, key: ref.key, locale: { in: written } },
        }),
    ];
    if (changes.length === 0) return calls;
    const reworded = changes.some((change) => !change.toShipped);
    for (const [locale, said] of Object.entries(line.locales)) {
        if (written.includes(locale) || said.value === null) continue;
        if (!reworded && !said.isCustom) continue;
        const name = { locale, namespace: ref.namespace, key: ref.key, reason: FLAG_TRANSLATE };
        calls.push(prisma.translationFlag.upsert({
            where: { locale_namespace_key_reason: name },
            update: {},
            create: name,
        }));
    }
    return calls;
}
